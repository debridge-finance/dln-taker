import {
  BPS_DENOMINATOR,
  buffersAreEqual,
  calculateExpectedTakeAmount,
  ChainEngine,
  ChainId,
  ClientError,
  evm,
  EvmChains,
  findExpectedBucket,
  getEngineByChainId,
  OrderData,
  OrderState,
  PreswapFulfillOrderPayload,
  tokenAddressToString,
  tokenStringToBuffer,
  ZERO_EVM_ADDRESS,
} from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";
import { Logger } from "pino";
import Web3 from "web3";

import { IncomingOrder, IncomingOrderContext, OrderInfoStatus} from "../interfaces";
import { createClientLogger } from "../logger";
import { EvmProviderAdapter, Tx } from "../providers/evm.provider.adapter";
import { SolanaProviderAdapter } from "../providers/solana.provider.adapter";

import { BaseOrderProcessor, OrderId, OrderProcessorContext, OrderProcessorInitContext, OrderProcessorInitializer } from "./base";
import { BatchUnlocker } from "./BatchUnlocker";
import { MempoolService } from "./mempool.service";
import { PostponingReason, RejectionReason } from "../hooks/HookEnums";
import { isRevertedError } from "./utils/isRevertedError";
import {
  SwapConnectorRequest,
  SwapConnectorResult
} from "@debridge-finance/dln-client/dist/types/swapConnector/swap.connector";

// reasonable multiplier for gas estimated for the fulfill txn to define max
// gas we are willing to estimate
const EVM_FULFILL_GAS_MULTIPLIER = 1.25;

// reasonable multiplier for gas price to define max gas price we are willing to
// bump until
const EVM_FULFILL_GAS_PRICE_MULTIPLIER = 1.3;

// dummy slippage used before any estimations are performed, this is needed only for estimation purposes
const DUMMY_SLIPPAGE_BPS = 400; // 4%

export type UniversalProcessorParams = {
  /**
   * desired profitability. Setting a higher value would prevent executor from fulfilling most orders because
   * the deBridge app and the API suggest users placing orders with as much margin as 4bps
   */
  minProfitabilityBps: number;
  /**
   * Mempool: max amount of seconds to wait before second attempt to process an order; default: 60s
   */
  mempoolInterval: number;
  /**
   * Mempool: amount of seconds to add to the max amount of seconds on each subsequent attempt; default: 30s
   */
  mempoolMaxDelayStep: number;
  /**
   * Number of orders (per every chain where orders are coming from and to) to accumulate to unlock them in batches
   *     Min: 1; max: 10, default: 10.
   *     This means that the executor would accumulate orders (that were fulfilled successfully) rather then unlock
   *     them on the go, and would send a batch of unlock commands every time enough orders were fulfilled, dramatically
   *     reducing the cost of the unlock command execution.
   *     You can set a lesser value to unlock orders more frequently, however please note that this value directly
   *     affects order profitability because the deBridge app and the API reserves the cost of unlock in the order's margin,
   *     assuming that the order would be unlocked in a batch of size=10. Reducing the batch size to a lower value increases
   *     your unlock costs and thus reduces order profitability, making them unprofitable most of the time.
   */
  batchUnlockSize: number;

  /**
   * Min slippage that can be used for swap from reserveToken to takeToken when calculated automatically
   */
  preFulfillSwapMinAllowedSlippageBps: number;

  /**
   * Max slippage that can be used for swap from reserveToken to takeToken when calculated automatically
   */
  preFulfillSwapMaxAllowedSlippageBps: number;
};

// Represents all necessary information about Created order during its internal lifecycle
type CreatedOrderMetadata = {
  readonly orderId: OrderId,
  readonly arrivedAt: Date,
  attempts: number,
  context: IncomingOrderContext
};

class UniversalProcessor extends BaseOrderProcessor {
  private mempoolService: MempoolService;
  private priorityQueue = new Set<OrderId>(); // queue of orderid for processing created order
  private queue = new Set<OrderId>(); // queue of orderid for retry processing order
  private isLocked: boolean = false;
  private batchUnlocker: BatchUnlocker;

  readonly #createdOrdersMetadata = new Map<OrderId, CreatedOrderMetadata>()

  private params: UniversalProcessorParams = {
    minProfitabilityBps: 4,
    mempoolInterval: 60,
    mempoolMaxDelayStep: 30,
    batchUnlockSize: 10,
    preFulfillSwapMinAllowedSlippageBps: 5,
    preFulfillSwapMaxAllowedSlippageBps: 400,
  };

  constructor(params?: Partial<UniversalProcessorParams>) {
    super();
    const batchUnlockSize = params?.batchUnlockSize;
    if (
      batchUnlockSize !== undefined &&
      (batchUnlockSize > 10 || batchUnlockSize < 1)
    ) {
      throw new Error("batchUnlockSize should be in [1, 10]");
    }
    Object.assign(this.params, params || {});
  }

  async init(
    chainId: ChainId,
    context: OrderProcessorInitContext
  ): Promise<void> {
    this.chainId = chainId;
    this.takeChain = context.takeChain;
    this.hooksEngine = context.hooksEngine;

    const logger = context.logger.child({
      processor: "universal",
      takeChainId: chainId,
    });

    this.batchUnlocker = new BatchUnlocker(
      logger,
      this.takeChain,
      this.params.batchUnlockSize,
      this.hooksEngine
    );

    this.mempoolService = new MempoolService(
      logger.child({ takeChainId: chainId }),
      this.tryProcess.bind(this),
      this.params.mempoolInterval
    );

    if (chainId !== ChainId.Solana) {
      const tokens: string[] = [];
      context.buckets.forEach((bucket) => {
        const tokensFromBucket = bucket.findTokens(this.chainId) || [];
        tokensFromBucket.forEach((token) => {
          tokens.push(tokenAddressToString(this.chainId, token));
        });
      });

      const client = this.takeChain.client as evm.PmmEvmClient;
      const evmProvider = this.takeChain.fulfillProvider as EvmProviderAdapter
      for (const token of tokens) {
        await evmProvider.approveToken(
          token,
          client.getContractAddress(
            chainId,
            evm.ServiceType.CrosschainForwarder
          ),
          logger
        );

        await evmProvider.approveToken(
          token,
          client.getContractAddress(chainId, evm.ServiceType.Destination),
          logger
        );
      }
    }
  }

  async process(params: IncomingOrderContext): Promise<void> {
    const { context, orderInfo } = params;
    const { orderId } = orderInfo;

    params.context.logger = context.logger.child({
      processor: "universal",
      orderId,
    });

    switch (orderInfo.status) {
      case OrderInfoStatus.Created:
      case OrderInfoStatus.ArchivalCreated: {

        if (!this.#createdOrdersMetadata.has(orderId)) {
          this.#createdOrdersMetadata.set(orderId, {
            orderId,
            arrivedAt: new Date(),
            attempts: 0,
            context: params
          })
        }

        // dequeue everything? right now I don't see any possible side effect of not dequeueing
        // this.clearInternalQueues(orderId);

        // override order params because there can be refreshed data (patches, newer confirmations, etc)
        this.#createdOrdersMetadata.get(orderId)!.context = params;

        return this.tryProcess(orderId);
      }
      case OrderInfoStatus.ArchivalFulfilled: {
        this.batchUnlocker.unlockOrder(orderId, orderInfo.order, context);
        return;
      }
      case OrderInfoStatus.Cancelled: {
        this.clearInternalQueues(orderId);
        this.clearOrderStore(orderId);
        context.logger.debug(`deleted from queues`);
        return;
      }
      case OrderInfoStatus.Fulfilled: {
        context.giveChain.nonFinalizedOrdersBudgetController.removeOrder(orderId);

        this.clearInternalQueues(orderId);
        this.clearOrderStore(orderId);
        context.logger.debug(`deleted from queues`);

        this.batchUnlocker.unlockOrder(orderId, orderInfo.order, context);
        return;
      }
      default: {
        context.logger.debug(
          `status=${OrderInfoStatus[orderInfo.status]} not implemented, skipping`
        );
        return;
      }
    }
  }

  private clearInternalQueues(orderId: string): void {
    this.queue.delete(orderId);
    this.priorityQueue.delete(orderId);
    this.mempoolService.delete(orderId);
  }

  private clearOrderStore(orderId: string): void {
    this.#createdOrdersMetadata.delete(orderId)
  }

  private async tryProcess(orderId: string): Promise<void> {
    const metadata = this.getCreatedOrderMetadata(orderId);
    const params = metadata.context

    const logger = params.context.logger;
    const orderInfo = params.orderInfo;

    // already processing an order
    if (this.isLocked) {
      logger.debug(
        `Processor is currently processing an order, postponing`
      );

      switch (orderInfo.status) {
        case OrderInfoStatus.ArchivalCreated: {
          this.queue.add(orderInfo.orderId);
          logger.debug(`postponed to secondary queue`);
          break;
        }
        case OrderInfoStatus.Created: {
          this.priorityQueue.add(orderInfo.orderId);
          logger.debug(`postponed to primary queue`);
          break;
        }
        default:
          throw new Error(
            `Unexpected order status: ${OrderInfoStatus[orderInfo.status]}`
          );
      }
      return;
    }

    // process this order
    this.isLocked = true;
    try {
      await this.processOrder(metadata);
    } catch (e) {
      const message = `processing order failed with an unhandled error: ${e}`;
      logger.error(message);
      logger.error(e);
      this.postponeOrder(metadata, message, PostponingReason.UNHANDLED_ERROR, true);
    }
    metadata.attempts++;
    this.isLocked = false;

    // forward to the next order
    // TODO try to get rid of recursion here. Use setInterval?
    const nextOrderId = this.pickNextOrderId();
    if (nextOrderId) {
      this.tryProcess(nextOrderId);
    }
  }

  private pickNextOrderId(): OrderId | undefined {
    const nextOrderId =
      this.priorityQueue.values().next().value ||
      this.queue.values().next().value;

    if (nextOrderId) {
      this.priorityQueue.delete(nextOrderId);
      this.queue.delete(nextOrderId);

      return nextOrderId;
    }
  }

  // gets the amount of sec to additionally wait until this order can be processed
  private getOrderRemainingDelay(firstSeen: Date, delay: number): number {
    if (delay > 0) {
      const delayMs = delay * 1000;

      const orderKnownFor = new Date().getTime() - firstSeen.getTime();

      if (delayMs > orderKnownFor) {
        return (delayMs - orderKnownFor) / 1000
      }
    }

    return 0;
  }

  private getCreatedOrderMetadata(orderId: OrderId): CreatedOrderMetadata {
    if (!this.#createdOrdersMetadata.has(orderId)) throw new Error(`Unexpected: missing created order data`)
    return this.#createdOrdersMetadata.get(orderId)!;
  }

  private postponeOrder(metadata: CreatedOrderMetadata, message: string, reason: PostponingReason, addToMempool: boolean = true, remainingDelay?: number) {
    const { attempts, context: { context, orderInfo } } = metadata;

    context.logger.info(message);
    this.hooksEngine.handleOrderPostponed({
      order: orderInfo,
      context,
      message,
      reason,
      attempts,
    });

    if (addToMempool)
      this.mempoolService.addOrder(metadata.orderId, remainingDelay, attempts)
  }

  private rejectOrder(metadata: CreatedOrderMetadata, message: string, reason: RejectionReason) {
    const { attempts, context: { context, orderInfo } } = metadata;

    context.logger.info(message);
    this.hooksEngine.handleOrderRejected({
      order: orderInfo,
      context,
      message,
      reason,
      attempts,
    });
  }

  private async processOrder(metadata: CreatedOrderMetadata): Promise<void | never> {
    const { context, orderInfo } = metadata.context;
    const orderId = orderInfo.orderId;
    const logger = context.logger;

    const bucket = context.config.buckets.find(
      (bucket) =>
        bucket.isOneOf(orderInfo.order.give.chainId, orderInfo.order.give.tokenAddress) &&
        bucket.findFirstToken(orderInfo.order.take.chainId) !== undefined
    );
    if (bucket === undefined) {
      const message = `no bucket found to cover order's give token: ${tokenAddressToString(orderInfo.order.give.chainId, orderInfo.order.give.tokenAddress)}`;
      return this.rejectOrder(metadata, message, RejectionReason.UNEXPECTED_GIVE_TOKEN);
    }

    // calculate USD worth of order
    const [giveTokenUsdRate, giveTokenDecimals] = await Promise.all([
      context.config.tokenPriceService.getPrice(
        orderInfo.order.give.chainId,
        buffersAreEqual(orderInfo.order.give.tokenAddress, tokenStringToBuffer(ChainId.Ethereum, ZERO_EVM_ADDRESS)) ? null : orderInfo.order.give.tokenAddress,
        {
          logger: createClientLogger(context.logger)
        }
      ),
      context.config.client.getDecimals(orderInfo.order.give.chainId, orderInfo.order.give.tokenAddress, context.giveChain.fulfillProvider.connection as Web3)
    ]);
    logger.debug(`usd rate for give token: ${giveTokenUsdRate}`);
    logger.debug(`decimals for give token: ${giveTokenDecimals}`);

    // converting give amount
    const usdWorth = BigNumber(giveTokenUsdRate)
      .multipliedBy(orderInfo.order.give.amount.toString())
      .dividedBy(new BigNumber(10).pow(giveTokenDecimals))
      .toNumber();
    logger.debug(`order worth in usd: ${usdWorth}`);

    let isFinalizedOrder = true;

    // compare worthiness of the order against block confirmation thresholds
    if (orderInfo.status == OrderInfoStatus.Created) {
      // find corresponding srcConstraints
      const srcConstraintsByValue = context.giveChain.srcConstraints.perOrderValue.find(srcConstraints => usdWorth <= srcConstraints.upperThreshold);
      const srcConstraints = srcConstraintsByValue || context.giveChain.srcConstraints;

      // find corresponding dstConstraints (they may supersede srcConstraints)
      const dstConstraintsByValue =
        context.takeChain.dstConstraints.perOrderValue.find(dstConstraints => usdWorth <= dstConstraints.upperThreshold)
        || context.takeChain.dstConstraints;

      // determine if we should postpone the order
      const fulfillmentDelay = dstConstraintsByValue.fulfillmentDelay || srcConstraints.fulfillmentDelay;
      const remainingDelay = this.getOrderRemainingDelay(metadata.arrivedAt, fulfillmentDelay);
      if (remainingDelay > 0) {
        const message = `order should be delayed by ${remainingDelay}s (why: fulfillment delay is set to ${fulfillmentDelay}s)`;
        return this.postponeOrder(metadata, message, PostponingReason.FORCED_DELAY, true, remainingDelay);
      }

      const finalizationInfo = (orderInfo as IncomingOrder<OrderInfoStatus.Created>).finalization_info;
      if (finalizationInfo == 'Revoked') {
        this.clearInternalQueues(orderInfo.orderId);

        const message = 'order has been revoked by the order feed due to chain reorganization';
        return this.rejectOrder(metadata, message, RejectionReason.REVOKED);
      }
      else if ('Confirmed' in finalizationInfo) {
        // we don't rely on ACTUAL finality (which can be retrieved from dln-taker's RPC node)
        // to avoid data discrepancy and rely on WS instead
        isFinalizedOrder = false;
        const announcedConfirmation = finalizationInfo.Confirmed.confirmation_blocks_count;
        logger.info(`order arrived with non-guaranteed finality, announced confirmation: ${announcedConfirmation}`);

        // ensure we can afford fulfilling this order and thus increasing our TVL
        if (!context.giveChain.nonFinalizedOrdersBudgetController.isFitsBudget(orderId, usdWorth)) {
          const message = 'order does not fit the budget, rejecting';
          return this.rejectOrder(metadata, message, RejectionReason.NON_FINALIZED_ORDERS_BUDGET_EXCEEDED)
        }

        // range found, ensure current block confirmation >= expected
        if (srcConstraintsByValue?.minBlockConfirmations) {
          logger.debug(`usdAmountConfirmationRange found: <=$${srcConstraintsByValue.upperThreshold}`)

          if (announcedConfirmation < srcConstraintsByValue.minBlockConfirmations) {
            const message = `announced block confirmations (${ announcedConfirmation }) is less than the block confirmation constraint (${srcConstraintsByValue.minBlockConfirmations} for order worth of $${usdWorth.toFixed(2)}`;
            return this.rejectOrder(metadata, message, RejectionReason.NOT_ENOUGH_BLOCK_CONFIRMATIONS_FOR_ORDER_WORTH)
          }
          else {
            logger.debug("accepting order for execution")
          }
        }
        else { // range not found: we do not accept this order, let it come finalized
          const message = `non-finalized order worth of $${usdWorth.toFixed(2)} is not covered by any custom block confirmation range`;
          return this.rejectOrder(metadata, message, RejectionReason.NOT_YET_FINALIZED);
        }

      }
      else if ('Finalized' in finalizationInfo) {
        // do nothing: order have stable finality according to the WS
        logger.debug('order source announced this order as finalized');
        context.giveChain.nonFinalizedOrdersBudgetController.removeOrder(orderId);
      }
    }

    // validate that order is not fullfilled
    // This must be done after 'Finalized' in finalizationInfo is checked because we may want to remove the order
    // from the nonFinalizedOrdersBudgetController
    const takeOrderStatus = await context.config.client.getTakeOrderStatus(
      orderInfo.orderId,
      orderInfo.order.take.chainId,
      { web3: this.takeChain.fulfillProvider.connection as Web3 }
    );
    if (
      takeOrderStatus?.status !== OrderState.NotSet &&
      takeOrderStatus?.status !== undefined
    ) {
      const message = `order is already handled on the take chain (${ ChainId[ orderInfo.order.take.chainId ] }), actual status: ${takeOrderStatus?.status}`;
      return this.rejectOrder(metadata, message, RejectionReason.ALREADY_FULFILLED_OR_CANCELLED)
    }

    // validate that order is created
    const giveOrderStatus = await context.config.client.getGiveOrderStatus(
      orderInfo.orderId,
      orderInfo.order.give.chainId,
      { web3: context.giveChain.fulfillProvider.connection as Web3 }
    );

    if (giveOrderStatus?.status === undefined) {
      const message = `order does not exist on the give chain (${ChainId[orderInfo.order.give.chainId]})`;
      return this.rejectOrder(metadata, message, RejectionReason.MISSING)
    }

    if (giveOrderStatus?.status !== OrderState.Created) {
      const message = `order has unexpected give status (${giveOrderStatus?.status}) on the give chain (${ChainId[ orderInfo.order.give.chainId]})`;
      return this.rejectOrder(metadata, message, RejectionReason.UNEXPECTED_GIVE_STATUS);
    }

    // perform rough estimation: assuming order.give.amount is what we need on balance
    const pickedBucket = findExpectedBucket(orderInfo.order, context.config.buckets);
    const [reserveSrcTokenDecimals, reserveDstTokenDecimals, takeTokenDecimals] = await Promise.all([
      context.config.client.getDecimals(orderInfo.order.give.chainId, pickedBucket.reserveSrcToken, context.giveChain.fulfillProvider.connection as Web3),
      context.config.client.getDecimals(orderInfo.order.take.chainId, pickedBucket.reserveDstToken, this.takeChain.fulfillProvider.connection as Web3),
      context.config.client.getDecimals(orderInfo.order.take.chainId, orderInfo.order.take.tokenAddress, this.takeChain.fulfillProvider.connection as Web3),
    ]);

    // reserveSrcToken is eq to reserveDstToken, but need to sync decimals
    const roughReserveDstDecimals = reserveSrcTokenDecimals - reserveDstTokenDecimals;
    let roughReserveDstAmount = BigNumber(orderInfo.order.give.amount.toString()).div(BigNumber(10).pow(roughReserveDstDecimals)).integerValue();
    logger.debug(`expressed order give amount (${orderInfo.order.give.amount.toString()}) in reserve dst token ${tokenAddressToString(orderInfo.order.take.chainId, pickedBucket.reserveDstToken)} @ ${ChainId[orderInfo.order.take.chainId]}: ${roughReserveDstAmount.toString()} `)

    const accountReserveBalance =
      await this.takeChain.fulfillProvider.getBalance(pickedBucket.reserveDstToken);
    if (new BigNumber(accountReserveBalance).lt(roughReserveDstAmount)) {
      const message = [
        `not enough funds of the reserve token (${tokenAddressToString(this.takeChain.chain, pickedBucket.reserveDstToken)}); `,
        `actual balance: ${new BigNumber(accountReserveBalance).div(BigNumber(10).pow(reserveDstTokenDecimals))}, `,
        `but expected ${new BigNumber(roughReserveDstAmount).div(BigNumber(10).pow(roughReserveDstDecimals))}`
      ].join('');
      return this.postponeOrder(metadata, message, PostponingReason.NOT_ENOUGH_BALANCE, isFinalizedOrder)
    }
    logger.debug(`enough balance (${accountReserveBalance.toString()}) to cover order (${roughReserveDstAmount.toString()})`)

    let evmFulfillGasLimit: number | undefined;
    let evmFulfillCappedGasPrice: BigNumber | undefined;
    let preswapTx: SwapConnectorResult<EvmChains> | undefined;
    if (getEngineByChainId(this.takeChain.chain) == ChainEngine.EVM) {
      // we need to perform fulfill estimation (to obtain planned gasLimit),
      // but we don't know yet how much reserveAmount should we pass. So, we simply pick
      // as much as giveAmount (without even subtracting operating expenses or fees) because we
      // don't care about profitability right now. This has two consequences:
      // 1. if underlying swap from giveAmount to takeToken does not give us enough takeAmount, the order is 100% non-profitable
      // 2. if txn estimation reverts, there can be a plenty of reasons: rebase token, corrupted swap route, order handled
      // If estimation succeeds, we have pretty realistic gasLimit and thus can do very good estimation
      // use takeAmount + dummySlippage as evaluatedTakeAmount
      const roughlyEvaluatedTakeAmount =
        orderInfo.order.take.amount + (
          orderInfo.order.take.amount * BigInt(BPS_DENOMINATOR - DUMMY_SLIPPAGE_BPS) / BigInt(BPS_DENOMINATOR)
        );
      try {
        const fulfillTx = await this.createOrderFullfillTx<ChainId.Ethereum>(
          orderInfo.orderId,
          orderInfo.order,
          pickedBucket.reserveDstToken,
          roughReserveDstAmount.toString(),
          roughlyEvaluatedTakeAmount,
          undefined,
          context,
          logger
        );

        //
        // predicting gas price cap
        //
        const currentGasPrice = BigNumber(
          await (this.takeChain.fulfillProvider.connection as Web3).eth.getGasPrice()
        );
        evmFulfillCappedGasPrice = currentGasPrice
          .multipliedBy(EVM_FULFILL_GAS_PRICE_MULTIPLIER)
          .integerValue();
        logger.debug(`capped gas price: ${evmFulfillCappedGasPrice.toFixed(0)}`)

        //
        // predicting gas limit
        //
        evmFulfillGasLimit = await (this.takeChain.fulfillProvider as EvmProviderAdapter).estimateGas({
          to: fulfillTx.tx.to,
          data: fulfillTx.tx.data,
          value: fulfillTx.tx.value.toString(),
        });
        logger.debug(`estimated gas needed for the fulfill tx with roughly estimated reserve amount: ${evmFulfillGasLimit} gas units`);

        evmFulfillGasLimit = Math.round(evmFulfillGasLimit * EVM_FULFILL_GAS_MULTIPLIER);
        logger.debug(`declared gas limit for the fulfill tx to be used in further estimations: ${evmFulfillGasLimit} gas units`);

        //
        // this needed to preserve swap routes (1inch specific)
        //
        preswapTx = fulfillTx.preswapTx;
      }
      catch (e) {
        let message;
        if (e instanceof ClientError) {
          message = `preliminary fullfil tx estimation failed: ${e}, reason: ${e.type}`;
          logger.error(message);
        }
        else {
          message = `unable to estimate preliminary fullfil tx: ${e}; this can be because the order is not profitable`;
          logger.error(message);
          logger.error(e);
        }
        return this.postponeOrder(metadata, message, PostponingReason.FULFILLMENT_EVM_TX_PREESTIMATION_FAILED, isFinalizedOrder);
      }
    }

    const batchSize =
      orderInfo.order.give.chainId === ChainId.Solana ||
      orderInfo.order.take.chainId === ChainId.Solana
        ? null
        : this.params.batchUnlockSize;

    const estimation = await calculateExpectedTakeAmount(
        orderInfo.order,
        this.params.minProfitabilityBps,
        {
          client: context.config.client,
          giveConnection: context.giveChain.fulfillProvider.connection as Web3,
          takeConnection: this.takeChain.fulfillProvider.connection as Web3,
          priceTokenService: context.config.tokenPriceService,
          buckets: context.config.buckets,
          swapConnector: context.config.swapConnector,
          logger: createClientLogger(logger),
          batchSize,
          evmFulfillGasLimit,
          evmFulfillCappedGasPrice: evmFulfillCappedGasPrice ? BigInt(evmFulfillCappedGasPrice.integerValue().toString()) : undefined,
          swapEstimationPreference: preswapTx,
        }
    );

    const {
      reserveDstToken,
      requiredReserveDstAmount,
      isProfitable,
      profitableTakeAmount,
    } = estimation;

    const hookEstimation = {
      isProfitable,
      reserveToken: reserveDstToken,
      requiredReserveAmount: requiredReserveDstAmount,
      fulfillToken: orderInfo.order?.take.tokenAddress!,
      projectedFulfillAmount: profitableTakeAmount,
    };
    this.hooksEngine.handleOrderEstimated({
      order: orderInfo,
      estimation: hookEstimation,
      context,
    });

    if (isProfitable) {
      logger.info("order is profitable");
    }
    else {
      let message = 'order is not profitable';
      if (new BigNumber(requiredReserveDstAmount).isEqualTo('0')) {
        message = 'not enough give amount to cover operating expenses';
      }
      else {
        const takeAmountDrop = new BigNumber(profitableTakeAmount).multipliedBy(100).div(orderInfo.order.take.amount.toString());
        const takeAmountDropShare = BigNumber(100).minus(takeAmountDrop).toFixed(2);

        const reserveTokenDesc = tokenAddressToString(this.takeChain.chain, reserveDstToken);
        const takeTokenDesc = tokenAddressToString(orderInfo.order.take.chainId, orderInfo.order.take.tokenAddress);
        message = [
          `order is estimated to be profitable when supplying `,
          `${new BigNumber(requiredReserveDstAmount).div(BigNumber(10).pow(reserveDstTokenDecimals))} `,
          `of reserve token (${reserveTokenDesc}) during fulfillment, `,
          `which gives only ${new BigNumber(profitableTakeAmount).div(BigNumber(10).pow(takeTokenDecimals))} `,
          `of take token (${takeTokenDesc}), `,
          `while order requires ${new BigNumber(orderInfo.order.take.amount.toString()).div(BigNumber(10).pow(takeTokenDecimals))} of take amount `,
          `(${takeAmountDropShare}% drop)`
        ].join("");
      }
      logger.info(`order is not profitable: ${message}`);
      return this.postponeOrder(metadata, message, PostponingReason.NOT_PROFITABLE, isFinalizedOrder);
    }

    if (!buffersAreEqual(reserveDstToken, pickedBucket.reserveDstToken)) {
      const message = `internal error: \
dln-taker has picked ${tokenAddressToString(orderInfo.order.take.chainId, pickedBucket.reserveDstToken)} as reserve token, \
while calculateExpectedTakeAmount returned ${tokenAddressToString(orderInfo.order.take.chainId, reserveDstToken)}`;
      throw new Error(message);
    }

    // fulfill order
    const { tx: fulfillTx } = await this.createOrderFullfillTx(
      orderInfo.orderId,
      orderInfo.order,
      reserveDstToken,
      requiredReserveDstAmount,
      BigInt(profitableTakeAmount),
      preswapTx,
      context,
      logger
    );
    if (getEngineByChainId(orderInfo.order.take.chainId) === ChainEngine.EVM) {
      try {
        const evmFulfillGas = await (this.takeChain.fulfillProvider as EvmProviderAdapter).estimateGas({
          ...fulfillTx as Tx,
        });
        logger.debug(`final fulfill tx gas estimation: ${evmFulfillGas}`)
        if (evmFulfillGas > evmFulfillGasLimit!) {
          const message = `final fulfill tx requires more gas units (${evmFulfillGas}) than it was declared during pre-estimation (${evmFulfillGasLimit})`;

          // reprocess order after 5s delay, but no more than two times in a row
          const maxFastTrackAttempts = 2; // attempts
          const fastTrackDelay = 5; // seconds
          const delay = metadata.attempts <= maxFastTrackAttempts ? fastTrackDelay : undefined;

          return this.postponeOrder(metadata, message, PostponingReason.FULFILLMENT_EVM_TX_ESTIMATION_EXCEEDED_PREESTIMATION, isFinalizedOrder, delay)
        }
      }
      catch (e) {
        const message = `unable to estimate fullfil tx: ${e}`;
        logger.error(message)
        logger.error(e);
        return this.postponeOrder(metadata, message, PostponingReason.FULFILLMENT_EVM_TX_ESTIMATION_FAILED, isFinalizedOrder);
      }

      (fulfillTx as Tx).gas = evmFulfillGasLimit;
      (fulfillTx as Tx).cappedGasPrice = evmFulfillCappedGasPrice;
    }

    try {
      // we add this order to the budget controller right before the txn is broadcasted
      // Mind that in case of an error (see the catch{} block below) we don't remove it from the
      // controller because the error may occur because the txn was stuck in the mempool and reside there
      // for a long period of time
      if (!isFinalizedOrder) {
        context.giveChain.nonFinalizedOrdersBudgetController.addOrder(orderId, usdWorth);
      }

      const txFulfill = await this.takeChain.fulfillProvider.sendTransaction(
        fulfillTx,
        { logger }
      );
      logger.info(`fulfill tx broadcasted, txhash: ${txFulfill}`);
      this.hooksEngine.handleOrderFulfilled({
        order: orderInfo,
        txHash: txFulfill,
      });
    } catch (e) {
      const message = `fulfill transaction failed: ${e}`;
      logger.error(message);
      logger.error(e);
      return this.postponeOrder(
        metadata,
        message,
        isRevertedError(e as Error)
          ? PostponingReason.FULFILLMENT_TX_REVERTED
          : PostponingReason.FULFILLMENT_TX_FAILED,
        isFinalizedOrder
      );
    }

    await this.waitIsOrderFulfilled(orderInfo.orderId, orderInfo.order, context, logger);

    // order is fulfilled, remove it from queues (the order may have come again thru WS)
    this.clearInternalQueues(orderInfo.orderId);
    logger.info(`order fulfilled: ${orderId}`);
  }

  private getPreFulfillSlippage(evaluatedTakeAmount: bigint, takeAmount: bigint): number {
    const calculatedSlippageBps = (evaluatedTakeAmount - takeAmount) * BigInt(BPS_DENOMINATOR) / evaluatedTakeAmount;
    if (calculatedSlippageBps < this.params.preFulfillSwapMinAllowedSlippageBps) return this.params.preFulfillSwapMinAllowedSlippageBps;
    if (calculatedSlippageBps > this.params.preFulfillSwapMaxAllowedSlippageBps) return this.params.preFulfillSwapMaxAllowedSlippageBps;
    return Number(calculatedSlippageBps);
  }

  private async createOrderFullfillTx<T extends ChainId>(
    orderId: string,
    order: OrderData,
    reserveDstToken: Uint8Array,
    reservedAmount: string,
    evaluatedTakeAmount: bigint,
    preferEstimation: SwapConnectorRequest['preferEstimation'] | undefined,
    context: OrderProcessorContext,
    logger: Logger
  ) {
    let fullFillTxPayload: PreswapFulfillOrderPayload<any> = {
      slippageBps: buffersAreEqual(reserveDstToken, order.take.tokenAddress)
        ? undefined
        : this.getPreFulfillSlippage(evaluatedTakeAmount, order.take.amount),
      swapConnector: context.config.swapConnector,
      reservedAmount: reservedAmount,
      loggerInstance: createClientLogger(logger),
      preferEstimation
    }
    if (order.take.chainId === ChainId.Solana) {
      const wallet = (this.takeChain.fulfillProvider as SolanaProviderAdapter)
        .wallet.publicKey;
      const solanaFullFillTxPayload: PreswapFulfillOrderPayload<ChainId.Solana> = {
        ...fullFillTxPayload,
        taker: wallet
      }
      fullFillTxPayload = solanaFullFillTxPayload;
    } else {
      const evmfullFillTxPayload: PreswapFulfillOrderPayload<EvmChains> = {
        ...fullFillTxPayload,
        web3: this.takeChain.fulfillProvider.connection as Web3,
        permit: "0x",
        takerAddress: this.takeChain.fulfillProvider.address,
        unlockAuthority: this.takeChain.unlockProvider.address
      };
      fullFillTxPayload = evmfullFillTxPayload;
    }

    const fulfillTx = await context.config.client.preswapAndFulfillOrder<T>(
      order,
      orderId,
      reserveDstToken,
      fullFillTxPayload as PreswapFulfillOrderPayload<T>
    );
    logger.debug(`fulfillTx is created`);
    logger.debug(fulfillTx);
    return fulfillTx;
  }
}

export const universalProcessor = (
  params?: Partial<UniversalProcessorParams>
): OrderProcessorInitializer => {
  return async (chainId: ChainId, context: OrderProcessorInitContext) => {
    const processor = new UniversalProcessor(params);
    await processor.init(chainId, context);
    return processor;
  };
};
