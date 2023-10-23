import { buffersAreEqual, OrderState, ChainId, Order } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { helpers } from '@debridge-finance/solana-utils';
import { DexlessChains } from '../config';
import { die } from '../errors';
import { RejectionReason, PostponingReason } from '../hooks/HookEnums';
import { createClientLogger } from '../dln-ts-client.utils';
import { CreatedOrder } from './order';
import { OrderEstimator } from './order-estimator';
import { OrderEvaluationContextual } from './order-evaluation-context';
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

  constructor(
    protected readonly order: CreatedOrder,
    protected readonly sc: TakerShortCircuit,
    context: { logger: Logger },
  ) {
    super();
    this.#logger = context.logger.child({ service: OrderValidator.name });
  }

  protected get logger() {
    return this.#logger;
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function, class-methods-use-this -- Intended for overriding in the upper classes
  protected async runChecks() {}

  async validate(): Promise<OrderEstimator> {
    await this.checkDisabled();
    await this.checkOrderId();
    await this.checkExternalCallHash();
    await this.checkAllowedTaker();
    await this.checkRouting();
    await this.checkPrefulfillSwapAbility();

    await this.checkTakeStatus();

    await this.checkFilters();
    await this.checkAccountBalance();
    await this.checkTVLBudget();
    await this.checkFinalization();
    await this.checkFulfillmentDelay();
    await this.checkThroughput();
    await this.checkRoughProfitability();
    await this.runChecks();

    // check again in case order has been already fulfilled
    await this.checkTakeStatus();

    // security check: does the order exists?
    await this.checkGiveStatus();

    return this.getOrderEstimator();
  }

  protected getOrderEstimator() {
    return new OrderEstimator(this.order, {
      logger: this.#logger,
      validationPayload: this.payload,
    });
  }

  private async checkFilters(): Promise<void> {
    const listOrderFilters = [
      ...this.order.takeChain.dstFilters,
      ...this.order.giveChain.srcFilters,
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
      const message = 'order has been filtered off, dropping';
      return this.sc.reject(RejectionReason.FILTERED_OFF, message);
    }
    return Promise.resolve();
  }

  private async checkDisabled(): Promise<void> {
    if (this.order.takeChain.disabledFulfill) {
      return this.sc.reject(RejectionReason.FILTERED_OFF, 'take chain is disabled');
    }
    return Promise.resolve();
  }

  private async checkAllowedTaker(): Promise<void> {
    if (this.order.orderData.allowedTaker) {
      if (
        !buffersAreEqual(
          this.order.takeChain.unlockAuthority.bytesAddress,
          this.order.orderData.allowedTaker,
        )
      ) {
        const message = `allowedTakerDst restriction; order requires expected allowed taker: ${this.order.orderData.allowedTaker.toAddress(
          this.order.orderData.take.chainId,
        )}; actual: ${this.order.takeChain.unlockAuthority.bytesAddress.toAddress(
          this.order.orderData.take.chainId,
        )}`;
        return this.sc.reject(RejectionReason.WRONG_TAKER, message);
      }
    }
    return Promise.resolve();
  }

  private async checkOrderId(): Promise<void> {
    const calculatedId = Order.calculateId(this.order.orderData);
    if (
      !buffersAreEqual(helpers.hexToBuffer(calculatedId), helpers.hexToBuffer(this.order.orderId))
    ) {
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
      const expectedExtCallHash =
        this.order.orderData.externalCall.externalCallHash || Buffer.alloc(0);
      if (!buffersAreEqual(calculatedExternalCallHash, expectedExtCallHash)) {
        const message = `externalCallHash mismatch; expected: ${helpers.bufferToHex(
          calculatedExternalCallHash,
        )}; actual: ${helpers.bufferToHex(expectedExtCallHash)}`;
        return this.sc.reject(RejectionReason.MALFORMED_ORDER, message);
      }
    }
    return Promise.resolve();
  }

  private async checkRouting(): Promise<void> {
    const { take, give } = this.order.orderData;
    const anyBucket = this.order.executor.buckets.find(
      (iteratedBucket) =>
        iteratedBucket.isOneOf(give.chainId, give.tokenAddress) &&
        iteratedBucket.findFirstToken(take.chainId) !== undefined,
    );

    if (anyBucket === undefined) {
      const message = `no bucket found to route order's give token: ${this.order.giveTokenAsString}`;
      return this.sc.reject(RejectionReason.UNEXPECTED_GIVE_TOKEN, message);
    }
    return Promise.resolve();
  }

  private async checkFulfillmentDelay(): Promise<void> {
    const srcConstraints = this.order.srcConstraints();
    const dstConstraints = this.order.dstConstraints();

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
        } over a budget of $${TVLBudgetController.budget} (current TVL: $${currentGiveTVL})`;
        return this.sc.postpone(PostponingReason.TVL_BUDGET_EXCEEDED, message);
      }
    }
    return Promise.resolve();
  }

  private async checkFinalization(): Promise<void> {
    if (this.order.finalization === 'Finalized') {
      // do nothing: order have stable finality according to the WS
      this.#logger.debug('announced as finalized');
    } else if (typeof this.order.finalization === 'number') {
      this.#logger.info(
        `announced as non-finalized at ${this.order.finalization} block confirmations`,
      );

      const srcConstraints = this.order.srcConstraintsRange();

      // range found, ensure current block confirmation >= expected
      if (srcConstraints) {
        this.#logger.debug(`using range #${srcConstraints.minBlockConfirmations}+`);

        const usdValue = await this.order.getUsdValue();
        if (usdValue > srcConstraints.upperThreshold) {
          const message = `range #${srcConstraints.minBlockConfirmations}+ only allows orders under $${srcConstraints.upperThreshold}, order is worth of $${usdValue}`;
          return this.sc.reject(
            RejectionReason.NOT_ENOUGH_BLOCK_CONFIRMATIONS_FOR_ORDER_WORTH,
            message,
          );
        }
      } else {
        // range not found: we do not accept this order, let it come finalized
        const message = `range for non-finalized order at  ${this.order.finalization} block confirmations not found`;
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
      const message = 'order does not fit throttled throughput';
      return this.sc.postpone(PostponingReason.CAPPED_THROUGHPUT, message);
    }
    return Promise.resolve();
  }

  private async checkTakeStatus(): Promise<void> {
    const takeChainId = this.order.takeChain.chain;
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
      // solana-specific: we want to accept orders even in the "processed" commitment level
      { confirmationsCount: 0 },
    );

    if (giveOrderStatus?.status === undefined) {
      const message = `order does not exist on the give chain (${ChainId[giveChainId]})`;
      return this.sc.postpone(PostponingReason.MISSING, message);
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
    const { reserveDstToken } = this.order.route;
    if (DexlessChains[take.chainId] && !buffersAreEqual(reserveDstToken, take.tokenAddress)) {
      const message = `pre-fulfill swaps are unavailable, can't perform pre-fulfill swap from ${reserveDstToken.toAddress(
        take.chainId,
      )} to ${take.tokenAddress.toAddress(take.chainId)}`;
      return this.sc.reject(RejectionReason.UNAVAILABLE_PRE_FULFILL_SWAP, message);
    }
    return Promise.resolve();
  }

  private async checkAccountBalance(): Promise<void> {
    const { chainId: takeChainId } = this.order.orderData.take;
    const { reserveDstToken } = this.order.route;

    // reserveSrcToken is eq to reserveDstToken, but need to sync decimals
    const maxProfitableReserveAmount =
      await this.order.getMaxProfitableReserveAmountWithoutOperatingExpenses();

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
    const maxProfitableReserveAmount =
      await this.order.getMaxProfitableReserveAmountWithoutOperatingExpenses();
    this.#logger.debug(`obtained max profitable reserve amount: ${maxProfitableReserveAmount}`);

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
        const message = `rough profitability estimation failed, swap outcome is estimated to be less than order's take amount; expected: ${this.order.orderData.take.amount} but actual: ${preliminarySwapResult.amountOut}`;
        return this.sc.postpone(PostponingReason.NOT_PROFITABLE, message);
      }

      this.setPayloadEntry('validationPreFulfillSwap', preliminarySwapResult);
    } else if (maxProfitableReserveAmount < this.order.orderData.take.amount) {
      const message = `rough profitability estimation failed, max profitable reserve amount is less than order's take amount; expected: ${this.order.orderData.take.amount} but actual: ${maxProfitableReserveAmount}`;
      return this.sc.postpone(PostponingReason.NOT_PROFITABLE, message);
    }

    return Promise.resolve();
  }
}
