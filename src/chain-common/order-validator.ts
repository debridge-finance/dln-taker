import { buffersAreEqual, OrderState, ChainId, Order } from '@debridge-finance/dln-client';
import { SwapConnectorResult } from 'node_modules/@debridge-finance/dln-client/dist/types/swapConnector/swap.connector';
import { Logger } from 'pino';
import { DexlessChains } from '../config';
import { die } from '../errors';
import { RejectionReason, PostponingReason } from '../hooks/HookEnums';
import { OrderInfoStatus } from '../interfaces';
import { createClientLogger } from '../dln-ts-client.utils';
import { CreatedOrder, OrderEvaluationContextual, OrderEvaluationPayload } from './order';
import { OrderEstimator } from './order-estimator';

export enum OrderValidationResult {
  Successful,
  ShouldPostpone,
  ShouldReject,
}
export type OrderValidation<T extends OrderValidationResult> = {
  result: T;
} & (T extends OrderValidationResult.Successful
  ? { estimator: OrderEstimator; payload: OrderEvaluationPayload }
  : {}) &
  (T extends OrderValidationResult.ShouldReject
    ? { rejection: RejectionReason; message: string }
    : {}) &
  (T extends OrderValidationResult.ShouldPostpone
    ? { postpone: PostponingReason; message: string; delay?: number }
    : {});

// gets the amount of sec to additionally wait until this order can be processed
function getOrderRemainingDelay(firstSeen: Date, delay: number): number {
  if (delay > 0) {
    const delayMs = delay * 1000;

    const orderKnownFor = new Date().getTime() - firstSeen.getTime();

    if (delayMs > orderKnownFor) {
      return (delayMs - orderKnownFor) / 1000;
    }
  }

  return 0;
}

export function rejectOrder(rejection: RejectionReason, message: string) {
  const error: OrderValidation<OrderValidationResult.ShouldReject> = {
    result: OrderValidationResult.ShouldReject,
    rejection,
    message,
  };
  return Promise.reject(error);
}

export function postponeOrder(postpone: PostponingReason, message: string, delay?: number) {
  const error: OrderValidation<OrderValidationResult.ShouldPostpone> = {
    result: OrderValidationResult.ShouldPostpone,
    postpone,
    message,
    delay,
  };
  return Promise.reject(error);
}

export class OrderValidator extends OrderEvaluationContextual {
  readonly #logger: Logger;

  #preliminarySwapResult?: SwapConnectorResult;

  constructor(
    protected readonly order: CreatedOrder,
    context: { logger: Logger },
  ) {
    super();
    this.#logger = context.logger.child({ service: OrderValidator.name });
  }

  protected get preliminarySwapResult() {
    return this.#preliminarySwapResult;
  }

  protected get logger() {
    return this.#logger;
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function, class-methods-use-this -- Intended for overriding in the upper classes
  protected async runChecks() {}

  async verify(): Promise<OrderValidation<any>> {
    try {
      await this.checkOrderId();
      await this.checkExternalCallHash();
      await this.checkAllowedTaker();
      await this.checkRouting();
      await this.checkTVLBudget();
      await this.checkFinalization();
      await this.checkFulfillmentDelay();
      await this.checkThroughput();
      await this.checkTakeStatus();
      await this.checkGiveStatus();
      await this.checkPrefulfillSwapAbility();
      await this.checkAccountBalance();
      await this.checkRoughProfitability();
      await this.runChecks();

      return this.getSuccessfulValidationResult();
    } catch (e) {
      if ((<OrderValidation<any>>e).result !== undefined) return <OrderValidation<any>>e;
      throw e;
    }
  }

  protected getSuccessfulValidationResult(): OrderValidation<OrderValidationResult.Successful> {
    return {
      result: OrderValidationResult.Successful,
      estimator: this.getOrderEstimator(),
      payload: this.payload,
    };
  }

  protected getOrderEstimator(): OrderEstimator {
    return new OrderEstimator(this.order, {
      logger: this.#logger,
      preferEstimation: this.#preliminarySwapResult,
      validationPayload: this.payload,
    });
  }

  private async checkAllowedTaker(): Promise<void> {
    if (this.order.orderData.allowedTaker) {
      if (
        !buffersAreEqual(
          this.order.takeChain.unlockProvider.bytesAddress,
          this.order.orderData.allowedTaker,
        )
      ) {
        const message = `The order includes the provided allowedTakerDst, which differs from the taker's address`;
        return rejectOrder(RejectionReason.WRONG_TAKER, message);
      }
    }
    return Promise.resolve();
  }

  private async checkOrderId(): Promise<void> {
    const calculatedId = Order.calculateId(this.order.orderData);
    if (calculatedId !== this.order.orderId) {
      const message = 'orderId mismatch';
      return rejectOrder(RejectionReason.MALFORMED_ORDER, message);
    }

    return Promise.resolve();
  }

  private async checkExternalCallHash(): Promise<void> {
    if (this.order.orderData.externalCall) {
      const calculatedExternalCallHash = Order.getExternalCallHash({
        externalCallData: this.order.orderData.externalCall.externalCallData,
      });
      if (
        !buffersAreEqual(
          calculatedExternalCallHash,
          this.order.orderData.externalCall.externalCallHash || Buffer.alloc(0),
        )
      ) {
        const message = 'externalCallHash mismatch';
        return rejectOrder(RejectionReason.MALFORMED_ORDER, message);
      }
    }
    return Promise.resolve();
  }

  private async checkRouting(): Promise<void> {
    const { take, give } = this.order.orderData;
    const bucket = this.order.executor.buckets.find(
      (iteratedBucket) =>
        iteratedBucket.isOneOf(give.chainId, give.tokenAddress) &&
        iteratedBucket.findFirstToken(take.chainId) !== undefined,
    );

    if (bucket === undefined) {
      const message = `no bucket found to cover order's give token: ${this.order.giveTokenAsString}`;
      return rejectOrder(RejectionReason.UNEXPECTED_GIVE_TOKEN, message);
    }
    return Promise.resolve();
  }

  private async checkFulfillmentDelay(): Promise<void> {
    if (this.order.status !== OrderInfoStatus.Created) return Promise.resolve();

    const [srcConstraints, dstConstraints] = await Promise.all([
      this.order.srcConstraints(),
      this.order.dstConstraints(),
    ]);

    // determine if we should postpone the order
    const fulfillmentDelay =
      dstConstraints.fulfillmentDelay || srcConstraints.fulfillmentDelay || 0;
    const remainingDelay = getOrderRemainingDelay(this.order.arrivedAt, fulfillmentDelay);

    if (remainingDelay > 0) {
      const message = `order should be delayed by ${remainingDelay}s (why: fulfillment delay is set to ${fulfillmentDelay}s)`;
      return postponeOrder(PostponingReason.FORCED_DELAY, message, remainingDelay);
    }
    return Promise.resolve();
  }

  private async checkTVLBudget(): Promise<void> {
    // ensuring this order does not increase TVL over a budget
    const { TVLBudgetController } = this.order.giveChain;
    if (TVLBudgetController.budget > 0) {
      const currentGiveTVL = await TVLBudgetController.getCurrentTVL();
      const usdValue = await this.order.getUsdValue();
      if (currentGiveTVL + usdValue > TVLBudgetController.budget) {
        const message = `order worth $${usdValue} increases TVL of the ${
          ChainId[this.order.giveChain.chain]
        } over a budget of $${
          TVLBudgetController.budget
        } (current TVL: $${currentGiveTVL}), thus postponing`;
        return postponeOrder(PostponingReason.TVL_BUDGET_EXCEEDED, message);
      }
    }
    return Promise.resolve();
  }

  private async checkFinalization(): Promise<void> {
    if (this.order.finalization === 'Finalized') {
      // do nothing: order have stable finality according to the WS
      this.#logger.debug('order announced as finalized');
    } else if (typeof this.order.finalization === 'number') {
      const usdValue = await this.order.getUsdValue();
      const srcConstraints = await this.order.srcConstraintsRange();
      // we don't rely on ACTUAL finality (which can be retrieved from dln-taker's RPC node)
      // to avoid data discrepancy and rely on WS instead
      const confirmationBlocksCount = this.order.finalization;
      this.#logger.info(
        `order announced as non-finalized at ${confirmationBlocksCount} block confirmations`,
      );

      // range found, ensure current block confirmation >= expected
      if (srcConstraints) {
        this.#logger.debug(`usdAmountConfirmationRange found: <=$${srcConstraints.upperThreshold}`);

        if (confirmationBlocksCount < srcConstraints.minBlockConfirmations) {
          const message = `announced block confirmations is less than the block confirmation constraint (${srcConstraints.minBlockConfirmations} for order worth of $${usdValue}`;
          return rejectOrder(
            RejectionReason.NOT_ENOUGH_BLOCK_CONFIRMATIONS_FOR_ORDER_WORTH,
            message,
          );
        }
      } else {
        // range not found: we do not accept this order, let it come finalized
        const message = `non-finalized order worth of $${usdValue} is not covered by any custom block confirmation range`;
        return rejectOrder(RejectionReason.NOT_YET_FINALIZED, message);
      }
    } else {
      die(`Unexpected finalization: ${this.order.finalization}`);
    }
    return Promise.resolve();
  }

  private async checkThroughput(): Promise<void> {
    // ensure we can afford fulfilling this order and thus increasing our TVL
    const isThrottled = this.order.giveChain.throughput.isThrottled(
      this.order.orderId,
      this.order.blockConfirmations,
      await this.order.getUsdValue(),
    );

    if (isThrottled) {
      const message = 'order does not fit the budget, rejecting';
      return postponeOrder(PostponingReason.CAPPED_THROUGHPUT, message);
    }
    return Promise.resolve();
  }

  private async checkTakeStatus(): Promise<void> {
    const takeChainId = this.order.takeChain.chain;
    // validate that order is not fullfilled
    // This must be done after 'Finalized' in finalizationInfo is checked because we may want to remove the order
    // from the nonFinalizedOrdersBudgetController
    const takeOrderStatus = await this.order.executor.client.getTakeOrderState(
      {
        orderId: this.order.orderId,
        takeChain: takeChainId,
      },
      {},
    );
    if (takeOrderStatus?.status !== OrderState.NotSet && takeOrderStatus?.status !== undefined) {
      const message = `order is already handled on the take chain (${ChainId[takeChainId]}), actual status: ${takeOrderStatus?.status}`;
      return rejectOrder(RejectionReason.ALREADY_FULFILLED_OR_CANCELLED, message);
    }
    return Promise.resolve();
  }

  private async checkGiveStatus(): Promise<void> {
    const giveChainId = this.order.giveChain.chain;

    // validate that order is created
    const giveOrderStatus = await this.order.executor.client.getGiveOrderState(
      {
        orderId: this.order.orderId,
        giveChain: giveChainId,
      },
      { confirmationsCount: this.order.blockConfirmations },
    );

    if (giveOrderStatus?.status === undefined) {
      const message = `order does not exist on the give chain (${ChainId[giveChainId]})`;
      return rejectOrder(RejectionReason.MISSING, message);
    }

    if (giveOrderStatus?.status !== OrderState.Created) {
      const message = `order has unexpected give status (${giveOrderStatus?.status}) on the give chain (${ChainId[giveChainId]})`;
      return rejectOrder(RejectionReason.UNEXPECTED_GIVE_STATUS, message);
    }
    return Promise.resolve();
  }

  private async checkPrefulfillSwapAbility(): Promise<void> {
    const { take } = this.order.orderData;

    // reject orders that require pre-fulfill swaps on the dexless chains (e.g. Linea)
    const pickedBucket = this.order.route;
    if (
      DexlessChains[take.chainId] &&
      !buffersAreEqual(pickedBucket.reserveDstToken, take.tokenAddress)
    ) {
      const message = `swaps are unavailable on ${
        ChainId[take.chainId]
      }, can't perform pre-fulfill swap from ${pickedBucket.reserveDstToken.toAddress(
        take.chainId,
      )} to ${take.tokenAddress.toAddress(take.chainId)}`;
      return rejectOrder(RejectionReason.UNAVAILABLE_PRE_FULFILL_SWAP, message);
    }
    return Promise.resolve();
  }

  private async checkAccountBalance(): Promise<void> {
    const { take } = this.order.orderData;
    const { route } = this.order;

    // reserveSrcToken is eq to reserveDstToken, but need to sync decimals
    const maxProfitableReserveAmount = await this.order.getMaxProfitableReserveAmount();

    const accountReserveBalance = await this.order.executor.client
      .getClient(this.order.takeChain.chain)
      .getBalance(
        this.order.takeChain.chain,
        route.reserveDstToken,
        this.order.takeChain.fulfillProvider.bytesAddress,
      );
    if (accountReserveBalance < maxProfitableReserveAmount) {
      const message = `not enough funds of the reserve token (${route.reserveDstToken.toAddress(
        take.chainId,
      )}); actual balance: ${await this.order.executor.formatTokenValue(
        take.chainId,
        route.reserveDstToken,
        accountReserveBalance,
      )}, but expected ${await this.order.executor.formatTokenValue(
        take.chainId,
        route.reserveDstToken,
        maxProfitableReserveAmount,
      )}`;

      return postponeOrder(PostponingReason.NOT_ENOUGH_BALANCE, message);
    }
    return Promise.resolve();
  }

  private async checkRoughProfitability(): Promise<void> {
    const maxProfitableReserveAmount = await this.order.getMaxProfitableReserveAmount();

    // now compare if aforementioned rough amount is still profitable
    if (this.order.route.requiresSwap) {
      // in dln client 6.0+ swaps are prepared outside of preswapAndFulfill method
      this.#preliminarySwapResult = await this.order.executor.swapConnector.getSwap(
        {
          amountIn: maxProfitableReserveAmount,
          chainId: this.order.orderData.take.chainId,
          fromTokenAddress: this.order.route.reserveDstToken,
          toTokenAddress: this.order.orderData.take.tokenAddress,
          slippageBps: 100, // dummy slippage 1%: we don't care about it here bc we need estimated outcome of the swap
          fromAddress: this.order.takeChain.fulfillProvider.bytesAddress,
          destReceiver: this.order.executor.client.getForwarderAddress(
            this.order.orderData.take.chainId,
          ),
        },
        {
          logger: createClientLogger(this.#logger),
        },
      );

      if (this.#preliminarySwapResult.amountOut < this.order.orderData.take.amount) {
        return postponeOrder(
          PostponingReason.NOT_PROFITABLE,
          'rough profitability estimation: order is not profitable',
        );
      }
    } else if (maxProfitableReserveAmount < this.order.orderData.take.amount) {
      return postponeOrder(
        PostponingReason.NOT_PROFITABLE,
        'rough profitability estimation: order is not profitable',
      );
    }
    return Promise.resolve();
  }
}
