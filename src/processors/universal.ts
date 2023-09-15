import {
  BPS_DENOMINATOR,
  buffersAreEqual,
  ChainEngine,
  ChainId,
  EvmChains,
  EvmInstruction,
  getEngineByChainId,
  Order,
  OrderDataWithId,
  OrderState,
  tokenAddressToString,
} from '@debridge-finance/dln-client';
import BigNumber from 'bignumber.js';
import { Logger } from 'pino';

import {
  SwapConnectorRequest,
  SwapConnectorResult,
} from 'node_modules/@debridge-finance/dln-client/dist/types/swapConnector/swap.connector';
import { helpers } from '@debridge-finance/solana-utils';
import {
  findExpectedBucket,
  calculateExpectedTakeAmount,
} from '@debridge-finance/legacy-dln-profitability';
import { VersionedTransaction } from '@solana/web3.js';
import { DlnClient, IncomingOrder, IncomingOrderContext, OrderInfoStatus } from '../interfaces';
import { createClientLogger } from '../logger';
import { EvmProviderAdapter, InputTransaction } from '../providers/evm.provider.adapter';

import {
  BaseOrderProcessor,
  OrderId,
  OrderProcessorContext,
  OrderProcessorInitContext,
  OrderProcessorInitializer,
} from './base';
import { BatchUnlocker } from './BatchUnlocker';
import { MempoolOpts, MempoolService } from './mempool.service';
import { PostponingReason, RejectionReason } from '../hooks/HookEnums';
import { isRevertedError } from './utils/isRevertedError';
import { DexlessChains } from '../config';
import { IExecutor } from '../executors/executor';
import { die, assert } from '../errors';

// reasonable multiplier for gas price to define max gas price we are willing to
// bump until. Must cover up to 12.5% block base fee increase
const EVM_FULFILL_GAS_PRICE_MULTIPLIER = 1.125;

// defines max batch_unlock size
const BATCH_UNLOCK_MAX_SIZE = 10;

// max size fo unlocks coming to giveChain=Solana. Must be less than
// TODO must be reimplemented so that batchSize can be set per giveChain, not per takeChain: #862kawqy0
const BATCH_UNLOCK_TO_SOLANA_MAX_SIZE = 7;

// dummy slippage used before any estimations are performed, this is needed only for estimation purposes
const DUMMY_SLIPPAGE_BPS = 400; // 4%

export type UniversalProcessorParams = {
  /**
   * desired profitability. Setting a higher value would prevent executor from fulfilling most orders because
   * the deBridge app and the API suggest users placing orders with as much margin as 4bps
   */
  minProfitabilityBps: number;
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

  mempool: MempoolOpts;
};

// Represents all necessary information about Created order during its internal lifecycle
type CreatedOrderMetadata = {
  readonly orderId: OrderId;
  readonly arrivedAt: Date;
  attempts: number;
  context: IncomingOrderContext;
};

class UniversalProcessor extends BaseOrderProcessor {
  // @ts-ignore Initialized deferredly within the init() method. Should be rewritten during the next major refactoring
  private mempoolService: MempoolService;

  // @ts-ignore Initialized deferredly within the init() method. Should be rewritten during the next major refactoring
  private batchUnlocker: BatchUnlocker;

  // @ts-ignore Initialized deferredly within the init() method. Should be rewritten during the next major refactoring
  private executor: IExecutor;

  private priorityQueue = new Set<OrderId>(); // queue of orderid for processing created order

  private queue = new Set<OrderId>(); // queue of orderid for retry processing order

  private isLocked: boolean = false;

  readonly #createdOrdersMetadata = new Map<OrderId, CreatedOrderMetadata>();

  private params: UniversalProcessorParams = {
    minProfitabilityBps: 4,
    batchUnlockSize: 10,
    preFulfillSwapMinAllowedSlippageBps: 5,
    preFulfillSwapMaxAllowedSlippageBps: 400,
    mempool: {
      baseDelay: 5,
      baseArchivalDelay: 60 * 2,
      delayStep: 10,
      archivalDelayStep: 60 * 5,
    },
  };

  constructor(params?: Partial<UniversalProcessorParams>) {
    super();
    const batchUnlockSize = params?.batchUnlockSize;
    assert(
      batchUnlockSize === undefined ||
        (batchUnlockSize <= BATCH_UNLOCK_MAX_SIZE && batchUnlockSize >= 1),
      `batchUnlockSize should be in [1, ${BATCH_UNLOCK_MAX_SIZE}]`,
    );
    Object.assign(this.params, params || {});
  }

  async init(
    chainId: ChainId,
    executor: IExecutor,
    context: OrderProcessorInitContext,
  ): Promise<void> {
    this.chainId = chainId;
    this.executor = executor;
    this.takeChain = context.takeChain;
    this.hooksEngine = context.hooksEngine;

    const logger = context.logger.child({
      processor: 'universal',
      takeChainId: chainId,
    });

    this.batchUnlocker = new BatchUnlocker(
      logger,
      this.takeChain,
      this.params.batchUnlockSize,
      this.hooksEngine,
    );

    this.mempoolService = new MempoolService(
      logger.child({ takeChainId: chainId }),
      this.params.mempool,
      (orderId: string) => this.consume(orderId),
    );

    if (chainId !== ChainId.Solana) {
      const tokens: string[] = [];
      context.buckets.forEach((bucket) => {
        const tokensFromBucket = bucket.findTokens(this.chainId) || [];
        tokensFromBucket.forEach((token) => {
          tokens.push(tokenAddressToString(this.chainId, token));
        });
      });

      const evmProvider = this.takeChain.fulfillProvider as EvmProviderAdapter;
      for (const token of tokens) {
        for (const contract of context.contractsForApprove) {
          // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
          await evmProvider.approveToken(token, contract, logger);
        }
      }
    }
  }

  process(params: IncomingOrderContext): void {
    const { context, orderInfo } = params;
    const { orderId } = orderInfo;

    switch (orderInfo.status) {
      case OrderInfoStatus.Created:
      case OrderInfoStatus.ArchivalCreated: {
        if (!this.#createdOrdersMetadata.has(orderId)) {
          this.#createdOrdersMetadata.set(orderId, {
            orderId,
            arrivedAt: new Date(),
            attempts: 0,
            context: params,
          });
        }

        // dequeue everything? right now I don't see any possible side effect of not dequeueing
        // this.clearInternalQueues(orderId);

        // override order params because there can be refreshed data (patches, newer confirmations, etc)
        this.#createdOrdersMetadata.get(orderId)!.context = params;

        this.consume(orderId);
        return;
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
        context.giveChain.TVLBudgetController.flushCache();
        context.takeChain.TVLBudgetController.flushCache();
        context.logger.debug(`deleted from queues`);

        this.batchUnlocker.unlockOrder(orderId, orderInfo.order, context);
        return;
      }
      default: {
        context.logger.debug(
          `status=${OrderInfoStatus[orderInfo.status]} not implemented, skipping`,
        );
      }
    }
  }

  private clearInternalQueues(orderId: string): void {
    this.queue.delete(orderId);
    this.priorityQueue.delete(orderId);
    this.mempoolService.delete(orderId);
  }

  private clearOrderStore(orderId: string): void {
    this.#createdOrdersMetadata.delete(orderId);
  }

  private consume(orderId: string) {
    const metadata = this.getCreatedOrderMetadata(orderId);

    // already processing an order
    if (this.isLocked) {
      const { status } = metadata.context.orderInfo;
      const { logger } = metadata.context.context;

      logger.debug(`Processor is currently processing an order, postponing`);

      switch (status) {
        case OrderInfoStatus.ArchivalCreated: {
          this.queue.add(orderId);
          logger.debug(`postponed to secondary queue`);
          break;
        }
        case OrderInfoStatus.Created: {
          this.priorityQueue.add(orderId);
          logger.debug(`postponed to primary queue`);
          break;
        }
        default: {
          die(`Unexpected order status: ${OrderInfoStatus[status]}`);
        }
      }

      return;
    }

    metadata.attempts++;
    // mind that order is being processed in a separate context
    this.processOrder(metadata);
  }

  private async processOrder(metadata: CreatedOrderMetadata): Promise<void> {
    assert(
      this.isLocked === false,
      `Processor invoked when being locked (orderId: ${metadata.orderId})`,
    );

    // process this order
    this.isLocked = true;
    try {
      await this.evaluateAndFulfill(metadata);
    } catch (e) {
      const { logger } = metadata.context.context;
      const message = `processing order failed with an unhandled error: ${e}`;
      logger.error(message);
      logger.error(e);
      this.postponeOrder(metadata, message, PostponingReason.UNHANDLED_ERROR, true);
    }
    this.isLocked = false;

    // forward to the next order
    // TODO try to get rid of recursion here. Use setInterval?
    const nextOrderId = this.pickNextOrderId();
    if (nextOrderId) {
      this.consume(nextOrderId);
    }
  }

  private pickNextOrderId(): OrderId | undefined {
    const nextOrderId =
      this.priorityQueue.values().next().value || this.queue.values().next().value;

    if (!nextOrderId) {
      return undefined;
    }
    this.priorityQueue.delete(nextOrderId);
    this.queue.delete(nextOrderId);

    return nextOrderId;
  }

  // gets the amount of sec to additionally wait until this order can be processed
  private static getOrderRemainingDelay(firstSeen: Date, delay: number): number {
    if (delay > 0) {
      const delayMs = delay * 1000;

      const orderKnownFor = new Date().getTime() - firstSeen.getTime();

      if (delayMs > orderKnownFor) {
        return (delayMs - orderKnownFor) / 1000;
      }
    }

    return 0;
  }

  private getCreatedOrderMetadata(orderId: OrderId): CreatedOrderMetadata {
    assert(
      this.#createdOrdersMetadata.has(orderId),
      `Unexpected: missing created order data (orderId: ${orderId})`,
    );
    return this.#createdOrdersMetadata.get(orderId)!;
  }

  private postponeOrder(
    metadata: CreatedOrderMetadata,
    message: string,
    reason: PostponingReason,
    addToMempool: boolean = true,
    remainingDelay?: number,
  ) {
    const {
      attempts,
      context: { context, orderInfo },
    } = metadata;

    context.logger.info(message);
    this.hooksEngine.handleOrderPostponed({
      order: orderInfo,
      context,
      message,
      reason,
      attempts,
    });

    if (addToMempool) {
      if (remainingDelay) {
        this.mempoolService.addOrder(metadata.orderId, remainingDelay);
      } else if (metadata.context.orderInfo.status === OrderInfoStatus.ArchivalCreated) {
        this.mempoolService.delayArchivalOrder(metadata.orderId, attempts);
      } else {
        this.mempoolService.delayOrder(metadata.orderId, attempts);
      }
    }
  }

  private rejectOrder(
    metadata: CreatedOrderMetadata,
    message: string,
    reason: RejectionReason,
  ): Promise<void> {
    const {
      attempts,
      context: { context, orderInfo },
    } = metadata;

    context.logger.info(message);
    this.hooksEngine.handleOrderRejected({
      order: orderInfo,
      context,
      message,
      reason,
      attempts,
    });

    return Promise.resolve();
  }

  private async evaluateAndFulfill(metadata: CreatedOrderMetadata): Promise<void> {
    const { context, orderInfo } = metadata.context;
    const { orderId } = orderInfo;
    const { logger } = context;

    //
    // verify order integrity
    //
    const calculatedId = Order.calculateId(orderInfo.order);
    if (calculatedId !== orderInfo.orderId) {
      const message = 'orderId mismatch';
      return this.rejectOrder(metadata, message, RejectionReason.MALFORMED_ORDER);
    }

    // verify externalCall and externalCallHash received from WS
    if (orderInfo.order.externalCall) {
      const calculatedExternalCallHash = Order.getExternalCallHash({
        externalCallData: orderInfo.order.externalCall.externalCallData,
      });
      if (
        !buffersAreEqual(
          calculatedExternalCallHash,
          orderInfo.order.externalCall.externalCallHash || Buffer.alloc(0),
        )
      ) {
        const message = 'extcallHash mismatch';
        return this.rejectOrder(metadata, message, RejectionReason.MALFORMED_ORDER);
      }
    }

    const bucket = context.config.buckets.find(
      (iteratedBucket) =>
        iteratedBucket.isOneOf(orderInfo.order.give.chainId, orderInfo.order.give.tokenAddress) &&
        iteratedBucket.findFirstToken(orderInfo.order.take.chainId) !== undefined,
    );
    if (bucket === undefined) {
      const message = `no bucket found to cover order's give token: ${tokenAddressToString(
        orderInfo.order.give.chainId,
        orderInfo.order.give.tokenAddress,
      )}`;
      return this.rejectOrder(metadata, message, RejectionReason.UNEXPECTED_GIVE_TOKEN);
    }

    // converting give amount
    const usdWorth = await this.executor.usdValueOfOrder(orderInfo.order);
    logger.debug(`order worth in usd: ${usdWorth}`);

    // ensuring this order does not increase TVL over a budget
    const { budget } = context.giveChain.TVLBudgetController;
    if (budget > 0) {
      const currentGiveTVL = await context.giveChain.TVLBudgetController.getCurrentTVL();
      if (currentGiveTVL + usdWorth > budget) {
        const message = `order worth $${usdWorth} increases TVL of the ${
          ChainId[context.giveChain.chain]
        } over a budget of $${budget} (current TVL: $${currentGiveTVL}), thus postponing`;
        return this.postponeOrder(metadata, message, PostponingReason.TVL_BUDGET_EXCEEDED, true);
      }
    }

    let isFinalizedOrder = true;
    let confirmationFloor: number | undefined;

    // compare worthiness of the order against block confirmation thresholds
    if (orderInfo.status === OrderInfoStatus.Created) {
      // find corresponding srcConstraints
      const srcConstraintsByValue = context.giveChain.srcConstraints.perOrderValue.find(
        (srcConstraints) => usdWorth <= srcConstraints.upperThreshold,
      );
      const srcConstraints = srcConstraintsByValue || context.giveChain.srcConstraints;

      // find corresponding dstConstraints (they may supersede srcConstraints)
      const dstConstraintsByValue =
        context.takeChain.dstConstraints.perOrderValue.find(
          (dstConstraints) => usdWorth <= dstConstraints.upperThreshold,
        ) || context.takeChain.dstConstraints;

      // determine if we should postpone the order
      const fulfillmentDelay =
        dstConstraintsByValue.fulfillmentDelay || srcConstraints.fulfillmentDelay;
      const remainingDelay = UniversalProcessor.getOrderRemainingDelay(
        metadata.arrivedAt,
        fulfillmentDelay,
      );
      if (remainingDelay > 0) {
        const message = `order should be delayed by ${remainingDelay}s (why: fulfillment delay is set to ${fulfillmentDelay}s)`;
        return this.postponeOrder(
          metadata,
          message,
          PostponingReason.FORCED_DELAY,
          true,
          remainingDelay,
        );
      }

      const finalizationInfo = (orderInfo as IncomingOrder<OrderInfoStatus.Created>)
        .finalization_info;
      if (finalizationInfo === 'Revoked') {
        this.clearInternalQueues(orderInfo.orderId);

        const message = 'order has been revoked by the order feed due to chain reorganization';
        return this.rejectOrder(metadata, message, RejectionReason.REVOKED);
      }
      if ('Confirmed' in finalizationInfo) {
        // we don't rely on ACTUAL finality (which can be retrieved from dln-taker's RPC node)
        // to avoid data discrepancy and rely on WS instead
        isFinalizedOrder = false;
        const announcedConfirmation = finalizationInfo.Confirmed.confirmation_blocks_count;
        logger.info(
          `order arrived with non-guaranteed finality, announced confirmation: ${announcedConfirmation}`,
        );

        // ensure we can afford fulfilling this order and thus increasing our TVL
        if (!context.giveChain.nonFinalizedOrdersBudgetController.isFitsBudget(orderId, usdWorth)) {
          const message = 'order does not fit the budget, rejecting';
          return this.rejectOrder(
            metadata,
            message,
            RejectionReason.NON_FINALIZED_ORDERS_BUDGET_EXCEEDED,
          );
        }

        // range found, ensure current block confirmation >= expected
        if (srcConstraintsByValue?.minBlockConfirmations) {
          logger.debug(
            `usdAmountConfirmationRange found: <=$${srcConstraintsByValue.upperThreshold}`,
          );

          if (announcedConfirmation < srcConstraintsByValue.minBlockConfirmations) {
            const message = `announced block confirmations (${announcedConfirmation}) is less than the block confirmation constraint (${
              srcConstraintsByValue.minBlockConfirmations
            } for order worth of $${usdWorth.toFixed(2)}`;
            return this.rejectOrder(
              metadata,
              message,
              RejectionReason.NOT_ENOUGH_BLOCK_CONFIRMATIONS_FOR_ORDER_WORTH,
            );
          }

          confirmationFloor = srcConstraintsByValue.minBlockConfirmations;
          logger.debug('accepting order for execution');
        } else {
          // range not found: we do not accept this order, let it come finalized
          const message = `non-finalized order worth of $${usdWorth.toFixed(
            2,
          )} is not covered by any custom block confirmation range`;
          return this.rejectOrder(metadata, message, RejectionReason.NOT_YET_FINALIZED);
        }
      } else if ('Finalized' in finalizationInfo) {
        // do nothing: order have stable finality according to the WS
        logger.debug('order source announced this order as finalized');
        context.giveChain.nonFinalizedOrdersBudgetController.removeOrder(orderId);
      }
    }

    // validate that order is not fullfilled
    // This must be done after 'Finalized' in finalizationInfo is checked because we may want to remove the order
    // from the nonFinalizedOrdersBudgetController
    const takeOrderStatus = await context.config.client.getTakeOrderState(
      {
        orderId: orderInfo.orderId,
        takeChain: orderInfo.order.take.chainId,
      },
      {},
    );
    if (takeOrderStatus?.status !== OrderState.NotSet && takeOrderStatus?.status !== undefined) {
      const message = `order is already handled on the take chain (${
        ChainId[orderInfo.order.take.chainId]
      }), actual status: ${takeOrderStatus?.status}`;
      return this.rejectOrder(metadata, message, RejectionReason.ALREADY_FULFILLED_OR_CANCELLED);
    }

    // validate that order is created
    const giveOrderStatus = await context.config.client.getGiveOrderState(
      {
        orderId: orderInfo.orderId,
        giveChain: orderInfo.order.give.chainId,
      },
      { confirmationsCount: confirmationFloor },
    );

    if (giveOrderStatus?.status === undefined) {
      const message = `order does not exist on the give chain (${
        ChainId[orderInfo.order.give.chainId]
      })`;
      return this.rejectOrder(metadata, message, RejectionReason.MISSING);
    }

    if (giveOrderStatus?.status !== OrderState.Created) {
      const message = `order has unexpected give status (${giveOrderStatus?.status}) on the give chain (${
        ChainId[orderInfo.order.give.chainId]
      })`;
      return this.rejectOrder(metadata, message, RejectionReason.UNEXPECTED_GIVE_STATUS);
    }

    // reject orders that require pre-fulfill swaps on the dexless chains (e.g. Linea)
    const pickedBucket = findExpectedBucket(orderInfo.order, context.config.buckets);
    if (
      DexlessChains[orderInfo.order.take.chainId] &&
      !buffersAreEqual(pickedBucket.reserveDstToken, orderInfo.order.take.tokenAddress)
    ) {
      const takeChainId = orderInfo.order.take.chainId;
      const message = `swaps are unavailable on ${
        ChainId[takeChainId]
      }, can't perform pre-fulfill swap from ${tokenAddressToString(
        takeChainId,
        pickedBucket.reserveDstToken,
      )} to ${tokenAddressToString(takeChainId, orderInfo.order.take.tokenAddress)}`;
      return this.rejectOrder(metadata, message, RejectionReason.UNAVAILABLE_PRE_FULFILL_SWAP);
    }

    // reserveSrcToken is eq to reserveDstToken, but need to sync decimals
    const roughReserveDstAmount = await this.executor.resyncDecimals(
      orderInfo.order.give.chainId,
      orderInfo.order.give.tokenAddress,
      orderInfo.order.give.amount,
      orderInfo.order.take.chainId,
      pickedBucket.reserveDstToken,
    );
    logger.debug(
      `expressed order give amount (${orderInfo.order.give.amount.toString()}) in reserve dst token ${tokenAddressToString(
        orderInfo.order.take.chainId,
        pickedBucket.reserveDstToken,
      )} @ ${ChainId[orderInfo.order.take.chainId]}: ${roughReserveDstAmount.toString()} `,
    );

    const accountReserveBalance = await this.executor.client
      .getClient(this.takeChain.chain)
      .getBalance(
        this.takeChain.chain,
        pickedBucket.reserveDstToken,
        this.takeChain.fulfillProvider.bytesAddress,
      );
    if (accountReserveBalance < roughReserveDstAmount) {
      const message = [
        `not enough funds of the reserve token (${tokenAddressToString(
          this.takeChain.chain,
          pickedBucket.reserveDstToken,
        )}); `,
        `actual balance: ${await this.executor.formatTokenValue(
          orderInfo.order.take.chainId,
          pickedBucket.reserveDstToken,
          accountReserveBalance,
        )}, `,
        `but expected ${await this.executor.formatTokenValue(
          orderInfo.order.take.chainId,
          pickedBucket.reserveDstToken,
          roughReserveDstAmount,
        )}`,
      ].join('');
      return this.postponeOrder(
        metadata,
        message,
        PostponingReason.NOT_ENOUGH_BALANCE,
        isFinalizedOrder,
      );
    }
    logger.debug(
      `enough balance (${accountReserveBalance.toString()}) to cover order (${roughReserveDstAmount.toString()})`,
    );

    let evmFulfillGasLimit: number | undefined;
    let evmFulfillCappedGasPrice: BigNumber | undefined;
    let preswapTx: SwapConnectorResult<EvmChains> | undefined;
    if (getEngineByChainId(this.takeChain.chain) === ChainEngine.EVM) {
      // we need to perform fulfill estimation (to obtain planned gasLimit),
      // but we don't know yet how much reserveAmount should we pass. So, we simply pick
      // as much as giveAmount (without even subtracting operating expenses or fees) because we
      // don't care about profitability right now. This has two consequences:
      // 1. if underlying swap from giveAmount to takeToken does not give us enough takeAmount, the order is 100% non-profitable
      // 2. if txn estimation reverts, there can be a plenty of reasons: rebase token, corrupted swap route, order handled
      // If estimation succeeds, we have pretty realistic gasLimit and thus can do very good estimation
      // use takeAmount + dummySlippage as evaluatedTakeAmount
      const roughlyEvaluatedTakeAmount =
        orderInfo.order.take.amount +
        (orderInfo.order.take.amount * BigInt(BPS_DENOMINATOR - BigInt(DUMMY_SLIPPAGE_BPS))) /
          BigInt(BPS_DENOMINATOR);
      const t = await this.createOrderFullfillTx<ChainEngine.EVM>(
        Order.getVerified({
          orderId: helpers.hexToBuffer(orderInfo.orderId),
          ...orderInfo.order,
        }),
        pickedBucket.reserveDstToken,
        roughReserveDstAmount.toString(),
        roughlyEvaluatedTakeAmount,
        undefined,
        context,
        logger,
      );

      const preliminaryEvmFulfillTx = <EvmInstruction>t.transaction;

      //
      // this needed to preserve swap routes (1inch specific)
      //
      preswapTx = <SwapConnectorResult<EvmChains>>t.swapResult;

      //
      // predicting gas price cap
      //
      const currentGasPrice = await (
        this.takeChain.fulfillProvider as EvmProviderAdapter
      ).getRequiredGasPrice();
      evmFulfillCappedGasPrice = currentGasPrice
        .multipliedBy(EVM_FULFILL_GAS_PRICE_MULTIPLIER)
        .integerValue();
      logger.debug(`capped gas price: ${evmFulfillCappedGasPrice.toFixed(0)}`);

      //
      // predicting gas limit
      //
      try {
        evmFulfillGasLimit = await (
          this.takeChain.fulfillProvider as EvmProviderAdapter
        ).estimateGas({
          to: preliminaryEvmFulfillTx.to,
          data: preliminaryEvmFulfillTx.data,
          value: preliminaryEvmFulfillTx.value.toString(),
        });
        logger.debug(
          `estimated gas needed for the fulfill tx with roughly estimated reserve amount: ${evmFulfillGasLimit} gas units`,
        );
      } catch (e) {
        const message = `unable to estimate preliminary fullfil tx: ${e}`;
        logger.error(message);
        logger.error({
          ...preliminaryEvmFulfillTx,
          from: this.takeChain.fulfillProvider.address,
        });
        return this.postponeOrder(
          metadata,
          message,
          PostponingReason.FULFILLMENT_EVM_TX_PREESTIMATION_FAILED,
          isFinalizedOrder,
        );
      }
    }

    const estimation = await calculateExpectedTakeAmount(
      orderInfo.order,
      this.params.minProfitabilityBps,
      {
        client: context.config.client,
        priceTokenService: context.config.tokenPriceService,
        buckets: context.config.buckets,
        swapConnector: context.config.swapConnector,
        logger: createClientLogger(logger),
        batchSize: this.getBatchUnlockSizeForProfitability(
          orderInfo.order.give.chainId,
          orderInfo.order.take.chainId,
        ),
        evmFulfillGasLimit,
        evmFulfillCappedGasPrice: evmFulfillCappedGasPrice
          ? BigInt(evmFulfillCappedGasPrice.integerValue().toString())
          : undefined,
        swapEstimationPreference: preswapTx,
      },
    );

    const { reserveDstToken, requiredReserveDstAmount, isProfitable, profitableTakeAmount } =
      estimation;

    const hookEstimation = {
      isProfitable,
      reserveToken: reserveDstToken,
      requiredReserveAmount: requiredReserveDstAmount,
      fulfillToken: orderInfo.order.take.tokenAddress,
      projectedFulfillAmount: profitableTakeAmount,
    };
    this.hooksEngine.handleOrderEstimated({
      order: orderInfo,
      estimation: hookEstimation,
      context,
    });

    const requiredReserveDstAmountBN = BigInt(
      new BigNumber(requiredReserveDstAmount).integerValue().toString(),
    );
    const profitableTakeAmountBN = BigInt(
      new BigNumber(profitableTakeAmount).integerValue().toString(),
    );

    if (isProfitable) {
      logger.info('order is profitable');
    } else {
      let message = 'order is not profitable';
      if (new BigNumber(requiredReserveDstAmount).isEqualTo('0')) {
        message = 'not enough give amount to cover operating expenses';
      } else {
        const takeAmountDrop = new BigNumber(profitableTakeAmount)
          .multipliedBy(100)
          .div(orderInfo.order.take.amount.toString());
        const takeAmountDropShare = BigNumber(100).minus(takeAmountDrop).toFixed(2);

        const reserveTokenDesc = tokenAddressToString(this.takeChain.chain, reserveDstToken);
        const takeTokenDesc = tokenAddressToString(
          orderInfo.order.take.chainId,
          orderInfo.order.take.tokenAddress,
        );
        message = [
          `order is estimated to be profitable when supplying `,
          `${await this.executor.formatTokenValue(
            orderInfo.order.take.chainId,
            reserveDstToken,
            requiredReserveDstAmountBN,
          )} `,
          `of reserve token (${reserveTokenDesc}) during fulfillment, `,
          `which gives only ${await this.executor.formatTokenValue(
            orderInfo.order.take.chainId,
            orderInfo.order.take.tokenAddress,
            profitableTakeAmountBN,
          )} `,
          `of take token (${takeTokenDesc}), `,
          `while order requires ${await this.executor.formatTokenValue(
            orderInfo.order.take.chainId,
            orderInfo.order.take.tokenAddress,
            orderInfo.order.take.amount,
          )} of take amount `,
          `(${takeAmountDropShare}% drop)`,
        ].join('');
      }
      logger.info(`order is not profitable: ${message}`);
      return this.postponeOrder(
        metadata,
        message,
        PostponingReason.NOT_PROFITABLE,
        isFinalizedOrder,
      );
    }

    assert(
      buffersAreEqual(reserveDstToken, pickedBucket.reserveDstToken),
      `internal error: dln-taker has picked ${tokenAddressToString(
        orderInfo.order.take.chainId,
        pickedBucket.reserveDstToken,
      )} as reserve token, while calculateExpectedTakeAmount returned ${tokenAddressToString(
        orderInfo.order.take.chainId,
        reserveDstToken,
      )}`,
    );

    // building fulfill transaction
    const { transaction: fulfillTx } = await this.createOrderFullfillTx(
      Order.getVerified({ orderId: helpers.hexToBuffer(orderInfo.orderId), ...orderInfo.order }),
      reserveDstToken,
      requiredReserveDstAmount,
      BigInt(profitableTakeAmount),
      preswapTx,
      context,
      logger,
    );

    let txToSend: VersionedTransaction | InputTransaction;
    if (getEngineByChainId(orderInfo.order.take.chainId) === ChainEngine.EVM) {
      // remap properties
      txToSend = <InputTransaction>{
        data: (<EvmInstruction>fulfillTx).data,
        to: (<EvmInstruction>fulfillTx).to,
        value: (<EvmInstruction>fulfillTx).value.toString(),

        // we set cappedTxFee as (pre-gasPrice * pre-gasLimit) because pre-*s are the values the profitability has been
        // estimated against. Now, if gasLimit goes up BUT gasPrice goes down, we still comfortable executing a txn
        cappedFee: evmFulfillCappedGasPrice!.multipliedBy(evmFulfillGasLimit!),
      };

      try {
        txToSend.gasLimit = await (
          this.takeChain.fulfillProvider as EvmProviderAdapter
        ).estimateGas(txToSend);
        logger.debug(`final fulfill tx gas estimation: ${txToSend.gasLimit}`);
      } catch (e) {
        const message = `unable to estimate fullfil tx: ${e}`;
        logger.error(message);
        logger.error(e);
        return this.postponeOrder(
          metadata,
          message,
          PostponingReason.FULFILLMENT_EVM_TX_ESTIMATION_FAILED,
          isFinalizedOrder,
        );
      }
    } else {
      txToSend = <VersionedTransaction>fulfillTx;
    }
    logger.debug('fulfill transaction built');
    logger.debug(txToSend);

    try {
      // we add this order to the budget controller right before the txn is broadcasted
      // Mind that in case of an error (see the catch{} block below) we don't remove it from the
      // controller because the error may occur because the txn was stuck in the mempool and reside there
      // for a long period of time
      if (!isFinalizedOrder) {
        context.giveChain.nonFinalizedOrdersBudgetController.addOrder(orderId, usdWorth);
      }

      const fulfillTxHash = await this.takeChain.fulfillProvider.sendTransaction(txToSend, {
        logger,
      });
      logger.info(`fulfill tx broadcasted, txhash: ${fulfillTxHash}`);
      this.hooksEngine.handleOrderFulfilled({
        order: orderInfo,
        txHash: fulfillTxHash,
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
        isFinalizedOrder,
      );
    }

    // order is fulfilled, remove it from queues (the order may have come again thru WS)
    this.clearInternalQueues(orderInfo.orderId);
    context.giveChain.TVLBudgetController.flushCache();
    logger.info(`order fulfilled: ${orderId}`);

    // putting the order to the mempool, in case fulfill_txn gets lost
    const fulfillCheckDelay: number =
      this.takeChain.fulfillProvider.avgBlockSpeed *
      this.takeChain.fulfillProvider.finalizedBlockCount;
    this.mempoolService.addOrder(metadata.orderId, fulfillCheckDelay);

    return Promise.resolve();
  }

  private getBatchUnlockSizeForProfitability(
    giveChain: ChainId,
    /* takeChain: ChainId */ {},
  ): number {
    // TODO must be reimplemented so that batchSize can be set per giveChain, not per takeChain: #862kawqy0

    // batch_unlock EVM -> Solana: accept up to 7 orders coming from Solana
    if (giveChain === ChainId.Solana)
      return Math.min(BATCH_UNLOCK_TO_SOLANA_MAX_SIZE, this.params.batchUnlockSize);

    // use default for any order
    return this.params.batchUnlockSize;
  }

  private getPreFulfillSlippage(evaluatedTakeAmount: bigint, takeAmount: bigint): number {
    const calculatedSlippageBps =
      ((evaluatedTakeAmount - takeAmount) * BigInt(BPS_DENOMINATOR)) / evaluatedTakeAmount;
    if (calculatedSlippageBps < this.params.preFulfillSwapMinAllowedSlippageBps)
      return this.params.preFulfillSwapMinAllowedSlippageBps;
    if (calculatedSlippageBps > this.params.preFulfillSwapMaxAllowedSlippageBps)
      return this.params.preFulfillSwapMaxAllowedSlippageBps;
    return Number(calculatedSlippageBps);
  }

  private async createOrderFullfillTx<T extends ChainEngine>(
    order: OrderDataWithId,
    reserveDstToken: Uint8Array,
    reservedAmount: string,
    evaluatedTakeAmount: bigint,
    preferEstimation: SwapConnectorRequest['preferEstimation'] | undefined,
    context: OrderProcessorContext,
    logger: Logger,
  ): Promise<{
    swapResult?: SwapConnectorRequest['preferEstimation'];
    transaction: Awaited<ReturnType<DlnClient['preswapAndFulfillOrder']>>;
  }> {
    if (buffersAreEqual(reserveDstToken, order.take.tokenAddress)) {
      return {
        transaction: await context.config.client.fulfillOrder(
          {
            order,
            loggerInstance: createClientLogger(logger),
          },
          {
            permit: '0x',
            taker: this.takeChain.fulfillProvider.bytesAddress,
            unlockAuthority: this.takeChain.unlockProvider.bytesAddress,
            externalCallRewardBeneficiary: this.executor.getSupportedChain(order.take.chainId)
              .beneficiary,
          },
        ),
      };
    }

    // in dln client 6.0+ swaps are prepared outside of preswapAndFulfill method
    const swapResult = await context.config.swapConnector.getSwap<
      T extends ChainEngine.Solana ? ChainId.Solana : EvmChains
    >(
      {
        amountIn: BigInt(reservedAmount),
        chainId: order.take.chainId,
        fromTokenAddress: reserveDstToken,
        toTokenAddress: order.take.tokenAddress,
        slippageBps: buffersAreEqual(reserveDstToken, order.take.tokenAddress)
          ? 0
          : this.getPreFulfillSlippage(evaluatedTakeAmount, order.take.amount),
        preferEstimation,
        fromAddress: this.takeChain.fulfillProvider.bytesAddress,
        destReceiver: context.config.client.getForwarderAddress(order.take.chainId),
      },
      {
        logger: createClientLogger(logger),
      },
    );

    if (swapResult.amountOut < order.take.amount) {
      throw new Error(
        `Pre-fulfill swap gives amount (${swapResult.amountOut.toString()}) lesser than order.takeAmount`,
      );
    }

    const transaction = await context.config.client.preswapAndFulfillOrder(
      {
        order,
        taker: this.takeChain.fulfillProvider.bytesAddress,
        swapResult,
        loggerInstance: createClientLogger(logger),
      },
      {
        unlockAuthority: this.takeChain.unlockProvider.bytesAddress,
        externalCallRewardBeneficiary: this.executor.getSupportedChain(order.take.chainId)
          .beneficiary,
      },
    );

    return {
      swapResult,
      transaction,
    };
  }
}

export const universalProcessor =
  (params?: Partial<UniversalProcessorParams>): OrderProcessorInitializer =>
  async (chainId: ChainId, executor: IExecutor, context: OrderProcessorInitContext) => {
    const processor = new UniversalProcessor(params);
    await processor.init(chainId, executor, context);
    return processor;
  };
