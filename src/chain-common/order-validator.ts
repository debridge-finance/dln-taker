import { buffersAreEqual, OrderState, ChainId, Order } from '@debridge-finance/dln-client';
import { SwapConnectorResult } from 'node_modules/@debridge-finance/dln-client/dist/types/swapConnector/swap.connector';
import { Logger } from 'pino';
import { DexlessChains } from '../config';
import { die } from '../errors';
import { RejectionReason, PostponingReason } from '../hooks/HookEnums';
import { createClientLogger } from '../dln-ts-client.utils';
import { CreatedOrder } from './order';
import { OrderEstimator } from './order-estimator';
import { OrderEvaluationContextual,  } from './shared';
import { helpers } from '@debridge-finance/solana-utils';
import { TakerShortCircuit } from './order-taker';


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

export class OrderValidator extends OrderEvaluationContextual {
  readonly #logger: Logger;

  #preliminarySwapResult?: SwapConnectorResult;

  constructor(
    protected readonly order: CreatedOrder,
    protected readonly sc: TakerShortCircuit,
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

  async validate(): Promise<OrderEstimator> {
    await this.checkFilters();
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

    return this.getOrderEstimator()
  }

  protected getOrderEstimator() {
    return new OrderEstimator(this.order, {
      logger: this.#logger,
      preferEstimation: this.#preliminarySwapResult,
      validationPayload: this.payload,
    });
  }

  private async checkFilters(): Promise<void> {
    const listOrderFilters = [
      ...this.order.takeChain.dstFilters,
      ...this.order.giveChain.srcFilters
    ];

      this.#logger.debug('running filters against the order');
      const orderFilters = await Promise.all(
        listOrderFilters.map((filter) =>
          filter(this.order.orderData, {
            logger: this.#logger,
            config: this.order.executor,
            giveChain: this.order.giveChain,
            takeChain: this.order.takeChain,
          }),
        ),
      );

      if (!orderFilters.every((it) => it)) {
        const message = 'order has been filtered off, dropping'
        return this.sc.reject(RejectionReason.FILTERED_OFF, message)
      }
  }

  private async checkAllowedTaker(): Promise<void> {
    if (this.order.orderData.allowedTaker) {
      if (
        !buffersAreEqual(
          this.order.takeChain.unlockAuthority.bytesAddress,
          this.order.orderData.allowedTaker,
        )
      ) {
        const message = `allowedTakerDst restriction; order requires expected allowed taker: ${this.order.orderData.allowedTaker.toAddress(this.order.orderData.take.chainId)}; actual: ${this.order.takeChain.unlockAuthority.bytesAddress.toAddress(this.order.orderData.take.chainId)}`;
        return this.sc.reject(RejectionReason.WRONG_TAKER, message);
      }
    }
    return Promise.resolve();
  }

  private async checkOrderId(): Promise<void> {
    const calculatedId = Order.calculateId(this.order.orderData);
    if (calculatedId !== this.order.orderId) {
      const message = `orderId mismatch; expected: ${calculatedId}, actual: ${this.order.orderId}`;
      return this.sc.reject(RejectionReason.MALFORMED_ORDER, message);
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
        const message = `externalCallHash mismatch; expected: ${helpers.bufferToHex(calculatedExternalCallHash)}; actual: ${helpers.bufferToHex(this.order.orderData.externalCall.externalCallHash || Buffer.alloc(0))}`;
        return this.sc.reject(RejectionReason.MALFORMED_ORDER, message);
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
      const message = `no bucket found to route order's give token: ${this.order.giveTokenAsString}`;
      return this.sc.reject(RejectionReason.UNEXPECTED_GIVE_TOKEN, message);
    }
    return Promise.resolve();
  }

  private async checkFulfillmentDelay(): Promise<void> {
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
      return this.sc.postpone(PostponingReason.FORCED_DELAY, message, remainingDelay);
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
        return this.sc.postpone(PostponingReason.TVL_BUDGET_EXCEEDED, message);
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
          return this.sc.reject(
            RejectionReason.NOT_ENOUGH_BLOCK_CONFIRMATIONS_FOR_ORDER_WORTH,
            message,
          );
        }
      } else {
        // range not found: we do not accept this order, let it come finalized
        const message = `non-finalized order worth of $${usdValue} is not covered by any custom block confirmation range`;
        return this.sc.reject(RejectionReason.NOT_YET_FINALIZED, message);
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
      const message = 'order does not fit the throughput, postponing';
      return this.sc.postpone(PostponingReason.CAPPED_THROUGHPUT, message);
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
      return this.sc.reject(RejectionReason.ALREADY_FULFILLED_OR_CANCELLED, message);
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
      return this.sc.reject(RejectionReason.MISSING, message);
    }

    if (giveOrderStatus?.status !== OrderState.Created) {
      const message = `order has unexpected give status (${giveOrderStatus?.status}) on the give chain (${ChainId[giveChainId]})`;
      return this.sc.reject(RejectionReason.UNEXPECTED_GIVE_STATUS, message);
    }
    return Promise.resolve();
  }

  private async checkPrefulfillSwapAbility(): Promise<void> {
    const { take } = this.order.orderData;

    // reject orders that require pre-fulfill swaps on the dexless chains (e.g. Linea)
    const {reserveDstToken} = this.order.route;
    if (
      DexlessChains[take.chainId] &&
      !buffersAreEqual(reserveDstToken, take.tokenAddress)
    ) {
      const message = `swaps are unavailable on ${
        ChainId[take.chainId]
      }, can't perform pre-fulfill swap from ${reserveDstToken.toAddress(
        take.chainId,
      )} to ${take.tokenAddress.toAddress(take.chainId)}`;
      return this.sc.reject(RejectionReason.UNAVAILABLE_PRE_FULFILL_SWAP, message);
    }
    return Promise.resolve();
  }

  private async checkAccountBalance(): Promise<void> {
    const { chainId: takeChainId } = this.order.orderData.take;
    const {reserveDstToken} = this.order.route;

    // reserveSrcToken is eq to reserveDstToken, but need to sync decimals
    const maxProfitableReserveAmount = await this.order.getMaxProfitableReserveAmount();

    const accountReserveBalance = await this.order.executor.client
      .getClient(this.order.takeChain.chain)
      .getBalance(
        this.order.takeChain.chain,
        reserveDstToken,
        this.order.takeChain.fulfillAuthority.bytesAddress,
      );
    if (accountReserveBalance < maxProfitableReserveAmount) {
      const message = `not enough funds of the reserve token (${reserveDstToken.toAddress(
        takeChainId,
      )}); actual balance: ${await this.order.executor.formatTokenValue(
        takeChainId,
        reserveDstToken,
        accountReserveBalance,
      )}, but expected ${await this.order.executor.formatTokenValue(
        takeChainId,
        reserveDstToken,
        maxProfitableReserveAmount,
      )}`;

      return this.sc.postpone(PostponingReason.NOT_ENOUGH_BALANCE, message);
    }
    return Promise.resolve();
  }

  private async checkRoughProfitability(): Promise<void> {
    const maxProfitableReserveAmount = await this.order.getMaxProfitableReserveAmount();
    this.#logger.debug(`obtained max profitable reserve amount: ${maxProfitableReserveAmount}`)

    // now compare if aforementioned rough amount is still profitable
    if (this.order.route.requiresSwap) {
      // in dln client 6.0+ swaps are prepared outside of preswapAndFulfill method
      const preliminarySwapResult = await this.order.executor.swapConnector.getSwap(
        {
          amountIn: maxProfitableReserveAmount,
          chainId: this.order.orderData.take.chainId,
          fromTokenAddress: this.order.route.reserveDstToken,
          toTokenAddress: this.order.orderData.take.tokenAddress,
          slippageBps: 100, // dummy slippage 1%: we don't care about it here bc we need estimated outcome of the swap
          fromAddress: this.order.takeChain.fulfillAuthority.bytesAddress,
          destReceiver: this.order.executor.client.getForwarderAddress(
            this.order.orderData.take.chainId,
          ),
        },
        {
          logger: createClientLogger(this.#logger),
        },
      );

      if (preliminarySwapResult.amountOut < this.order.orderData.take.amount) {
        const message = `rough profitability estimation failed, swap outcome is estimated to be less than order's take amount; expected: ${this.order.orderData.take.amount} but actual: ${preliminarySwapResult.amountOut}`
        return this.sc.postpone(
          PostponingReason.NOT_PROFITABLE,
          message,
        );
      }
      else {
        this.#preliminarySwapResult = preliminarySwapResult
      }
    } else if (maxProfitableReserveAmount < this.order.orderData.take.amount) {
      const message = `rough profitability estimation failed, max profitable reserve amount is less than order's take amount; expected: ${this.order.orderData.take.amount} but actual: ${maxProfitableReserveAmount}`
      return this.sc.postpone(
        PostponingReason.NOT_PROFITABLE,
        message,
      );
    }

    return Promise.resolve();
  }
}
