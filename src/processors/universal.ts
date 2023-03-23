import {
  buffersAreEqual,
  calculateExpectedTakeAmount,
  ChainId,
  evm,
  OrderData,
  OrderState,
  tokenAddressToString,
  tokenStringToBuffer,
  ZERO_EVM_ADDRESS,
} from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";
import { Logger } from "pino";
import Web3 from "web3";

import { IncomingOrder, IncomingOrderContext, OrderInfoStatus } from "../interfaces";
import { createClientLogger } from "../logger";
import { EvmProviderAdapter } from "../providers/evm.provider.adapter";
import { SolanaProviderAdapter } from "../providers/solana.provider.adapter";

import {
  BaseOrderProcessor,
  OrderProcessorContext,
  OrderProcessorInitContext,
  OrderProcessorInitializer,
} from "./base";
import { BatchUnlocker } from "./BatchUnlocker";
import { MempoolService } from "./mempool.service";
import { approveToken } from "./utils/approve";

import { isRevertedError } from "./utils/isRevertedError";
import { OrderPostponedHookReason, OrderRejectedHookReason } from "../hooks/HookEnums";


export type UniversalProcessorParams = {
  /**
   * desired profitability. Setting a higher value would prevent executor from fulfilling most orders because
   * the deBridge app and the API suggest users placing orders with as much margin as 4bps
   */
  minProfitabilityBps: number;
  /**
   * how often to re-evaluate orders that were not fulfilled for a reason
   */
  mempoolInterval: number;
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
};

class UniversalProcessor extends BaseOrderProcessor {
  private mempoolService: MempoolService;
  private priorityQueue = new Set<string>(); // queue of orderid for processing created order
  private queue = new Set<string>(); // queue of orderid for retry processing order
  private incomingOrdersMap = new Map<string, IncomingOrderContext>(); // key orderid, contains incoming order from order feed
  private isLocked: boolean = false;
  private batchUnlocker: BatchUnlocker;

  private params: UniversalProcessorParams = {
    minProfitabilityBps: 4,
    mempoolInterval: 60, // every 60s
    batchUnlockSize: 10,
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
      context.hooksEngine,
    );

    this.mempoolService = new MempoolService(
      logger.child({ takeChainId: chainId }),
      this.process.bind(this),
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
      for (const token of tokens) {
        await approveToken(
          chainId,
          token,
          client.getContractAddress(
            chainId,
            evm.ServiceType.CrosschainForwarder
          ),
          this.takeChain.fulfullProvider as EvmProviderAdapter,
          logger
        );

        await approveToken(
          chainId,
          token,
          client.getContractAddress(chainId, evm.ServiceType.Destination),
          this.takeChain.fulfullProvider as EvmProviderAdapter,
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
      case OrderInfoStatus.ArchivalCreated:
      case OrderInfoStatus.Created: {
        // must remove this order from all queues bc new order can be an updated version
        this.clearInternalQueues(orderId);
        return this.tryProcess(orderInfo, context);
      }
      case OrderInfoStatus.ArchivalFulfilled: {
        this.batchUnlocker.unlockOrder(orderId, orderInfo.order, context);
        return;
      }
      case OrderInfoStatus.Cancelled: {
        this.clearInternalQueues(orderId);
        context.logger.debug(`deleted from queues`);
        return;
      }
      case OrderInfoStatus.Fulfilled: {
        this.clearInternalQueues(orderId);
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
    this.incomingOrdersMap.delete(orderId)
    this.mempoolService.delete(orderId);
  }

  private async tryProcess(orderInfo: IncomingOrder<OrderInfoStatus.Created | OrderInfoStatus.ArchivalCreated>, context: OrderProcessorContext): Promise<void> {
    // already processing an order
    if (this.isLocked) {
      context.logger.debug(
        `Processor is currently processing an order, postponing`
      );

      switch (orderInfo.status) {
        case OrderInfoStatus.ArchivalCreated: {
          this.queue.add(orderInfo.orderId);
          context.logger.debug(`postponed to secondary queue`);
          break;
        }
        case OrderInfoStatus.Created: {
          this.priorityQueue.add(orderInfo.orderId);
          context.logger.debug(`postponed to primary queue`);
          break;
        }
        default:
          throw new Error(
            `Unexpected order status: ${OrderInfoStatus[orderInfo.status]}`
          );
      }
      this.incomingOrdersMap.set(orderInfo.orderId, { orderInfo, context });
      return;
    }

    // process this order
    this.isLocked = true;
    try {
      await this.processOrder(orderInfo, context);
    } catch (e) {
      context.logger.error(`processing order failed with error: ${e}`);
      context.logger.error(e);
    }
    this.isLocked = false;

    // forward to the next order
    // TODO try to get rid of recursion here. Use setInterval?
    const nextOrder = this.pickNextOrder();
    if (nextOrder) {
      this.tryProcess(nextOrder.orderInfo, nextOrder.context);
    }
  }

  private pickNextOrder() {
    const nextOrderId =
      this.priorityQueue.values().next().value ||
      this.queue.values().next().value;

    if (nextOrderId) {
      const order = this.incomingOrdersMap.get(nextOrderId);

      this.priorityQueue.delete(nextOrderId);
      this.queue.delete(nextOrderId);
      this.incomingOrdersMap.delete(nextOrderId);

      return order;
    }
  }

  private async processOrder(
    orderInfo: IncomingOrder<OrderInfoStatus.Created | OrderInfoStatus.ArchivalCreated>, context: OrderProcessorContext
  ): Promise<void | never> {
    const logger = context.logger;

    const bucket = context.config.buckets.find(
      (bucket) =>
        bucket.isOneOf(orderInfo.order.give.chainId, orderInfo.order.give.tokenAddress) &&
        bucket.findFirstToken(orderInfo.order.take.chainId) !== undefined
    );
    if (bucket === undefined) {
      this.hooksEngine.handleOrderRejected({
        order: orderInfo,
        reason: OrderRejectedHookReason.UNEXPECTED_GIVE_TOKEN,
        context,
      });
      logger.info(
        `no bucket found to cover order's give token: ${tokenAddressToString(
          orderInfo.order.give.chainId,
          orderInfo.order.give.tokenAddress
        )}, skipping`
      );
      return;
    }

    // validate that order is not fullfilled
    const takeOrderStatus = await context.config.client.getTakeOrderStatus(
      orderInfo.orderId,
      orderInfo.order.take.chainId,
      { web3: this.takeChain.fulfullProvider.connection as Web3 }
    );
    if (
      takeOrderStatus?.status !== OrderState.NotSet &&
      takeOrderStatus?.status !== undefined
    ) {
      this.hooksEngine.handleOrderRejected({
        order: orderInfo,
        reason: OrderRejectedHookReason.ALREADY_FULFILLED,
        context,
      });
      logger.info("order is already handled on the give chain, skipping");
      return;
    }

    // validate that order is created
    const giveOrderStatus = await context.config.client.getGiveOrderStatus(
      orderInfo.orderId,
      orderInfo.order.give.chainId,
      { web3: context.giveChain.fulfullProvider.connection as Web3 }
    );

    if (giveOrderStatus?.status === undefined) {
      logger.info("order is not exists in give chain");
      this.hooksEngine.handleOrderRejected({
        order: orderInfo,
        reason: OrderRejectedHookReason.ALERT_GIVE_MISSING,
        context,
      });
      return;
    }

    if (giveOrderStatus?.status !== OrderState.Created) {
      logger.info("order has wrong status");
      this.hooksEngine.handleOrderRejected({
        order: orderInfo,
        reason: OrderRejectedHookReason.WRONG_GIVE_STATUS,
        context,
      });
      return;
    }

    let allowPlaceToMempool = true;

    // compare worthiness of the order against block confirmation thresholds
    if (orderInfo.status == OrderInfoStatus.Created) {
      const finalizationInfo = (orderInfo as IncomingOrder<OrderInfoStatus.Created>).finalization_info;
      if (finalizationInfo == 'Revoked') {
        logger.info('order has been revoked, cleaning and skipping');
        this.clearInternalQueues(orderInfo.orderId);
        return;
      }
      else if ('Confirmed' in finalizationInfo) {
        // we don't rely on ACTUAL finality (which can be retrieved from dln-taker's RPC node)
        // to avoid data discrepancy and rely on WS instead
        const announcedConfirmation = finalizationInfo.Confirmed.confirmation_blocks_count;
        logger.info(`order announced with custom finality, announced confirmation: ${announcedConfirmation}`);

        // we don't want this order to be put to mempool because we don't query actual block confirmations
        allowPlaceToMempool = false;
        logger.debug(`order won't appear in the mempool`)

        // calculate USD worth of order
        const [giveTokenUsdRate, giveTokenDecimals] = await Promise.all([
          context.config.tokenPriceService.getPrice(
            orderInfo.order.give.chainId,
            buffersAreEqual(orderInfo.order.give.tokenAddress, tokenStringToBuffer(ChainId.Ethereum, ZERO_EVM_ADDRESS)) ? null : orderInfo.order.give.tokenAddress,
            {
              logger: createClientLogger(context.logger)
            }
          ),
          context.config.client.getDecimals(orderInfo.order.give.chainId, orderInfo.order.give.tokenAddress, context.giveChain.fulfullProvider.connection as Web3)
        ]);
        logger.debug(`usd rate for give token: ${giveTokenUsdRate}`)
        logger.debug(`decimals for give token: ${giveTokenDecimals}`)

        // converting give amount
        const usdWorth = BigNumber(giveTokenUsdRate)
          .multipliedBy(orderInfo.order.give.amount.toString())
          .dividedBy(new BigNumber(10).pow(giveTokenDecimals))
          .toNumber();
        logger.debug(`order worth in usd: ${usdWorth}`)

        // find appropriate range corresponding to this USD worth
        const range = context.config.chains[orderInfo.order.give.chainId]!.usdAmountConfirmations.find(
          usdWorthRange => usdWorthRange.usdWorthFrom < usdWorth && usdWorth <= usdWorthRange.usdWorthTo
        );

        // range found, ensure current block confirmation >= expected
        if (range?.minBlockConfirmations) {
          logger.debug(`usdAmountConfirmationRange found: (${range.usdWorthFrom}, ${range.usdWorthTo}]`)

          if (announcedConfirmation < range.minBlockConfirmations) {
            logger.info("announced block confirmations is less than the block confirmation constraint; skipping the order")
            return;
          }
          else {
            logger.debug("accepting order for execution")
          }
        }
        else { // range not found: we do not accept this order, let it come finalized
          logger.debug('non-finalized order is not covered by any custom block confirmation range, skipping')
          return;
        }

      }
      else if ('Finalized' in finalizationInfo) {
        // do nothing: order have stable finality according to the WS
        logger.debug('order source announced this order as finalized')
      }
    }

    const batchSize =
      orderInfo.order.give.chainId === ChainId.Solana ||
      orderInfo.order.take.chainId === ChainId.Solana
        ? null
        : this.params.batchUnlockSize;

    let estimation;
    try {
      estimation = await calculateExpectedTakeAmount(
        orderInfo.order,
        this.params.minProfitabilityBps,
        {
          client: context.config.client,
          giveConnection: context.giveChain.fulfullProvider.connection as Web3,
          takeConnection: this.takeChain.fulfullProvider.connection as Web3,
          priceTokenService: context.config.tokenPriceService,
          buckets: context.config.buckets,
          swapConnector: context.config.swapConnector,
          logger: createClientLogger(logger),
          batchSize,
        }
      );
    } catch (e) {
      const error = e as Error;
      this.hooksEngine.handleOrderPostponed({
        order: orderInfo,
        estimation: undefined,
        context,
        reason: OrderPostponedHookReason.ESTIMATION_FAILED,
        message: error.message,
      });
      context.logger.error(`Error in estimation ${e}`);
      context.logger.error(e);
      return;
    }

    const {
      reserveDstToken,
      requiredReserveDstAmount,
      isProfitable,
      reserveToTakeSlippageBps,
    } = estimation;

    const hookEstimation = {
      isProfitable,
      reserveToken: reserveDstToken,
      requiredReserveAmount: requiredReserveDstAmount,
      fulfillToken: orderInfo.order?.take.tokenAddress!,
      projectedFulfillAmount: orderInfo.order.take.amount!.toString(),
    };
    this.hooksEngine.handleOrderEstimated({
      order: orderInfo,
      estimation: hookEstimation,
      context,
    });

    if (!isProfitable) {
      this.hooksEngine.handleOrderPostponed({
        order: orderInfo,
        estimation: hookEstimation,
        context,
        reason: OrderPostponedHookReason.NON_PROFITABLE,
      });

      logger.info("order is not profitable");
      if (allowPlaceToMempool)
        this.mempoolService.addOrder({ orderInfo, context });
      return;
    }

    const accountReserveBalance =
      await this.takeChain.fulfullProvider.getBalance(reserveDstToken);

    if (new BigNumber(accountReserveBalance).lt(requiredReserveDstAmount)) {
      this.hooksEngine.handleOrderPostponed({
        order: orderInfo,
        estimation: hookEstimation,
        context,
        reason: OrderPostponedHookReason.NOT_ENOUGH_BALANCE,
      });

      logger.info(
        `not enough reserve token on balance: ${accountReserveBalance} actual, but expected ${requiredReserveDstAmount}`
      );
      if (allowPlaceToMempool)
        this.mempoolService.addOrder({ orderInfo, context });
      return;
    }

    // fulfill order
    const fulfillTx = await this.createOrderFullfillTx(
      orderInfo.orderId,
      orderInfo.order,
      reserveDstToken,
      requiredReserveDstAmount,
      reserveToTakeSlippageBps,
      context,
      logger
    );

    try {
      const txFulfill = await this.takeChain.fulfullProvider.sendTransaction(
        fulfillTx.tx,
        { logger }
      );
      this.hooksEngine.handleOrderFulfilled({
        order: orderInfo,
        txHash: txFulfill,
      });
      logger.info(`fulfill transaction ${txFulfill} is completed`);
    } catch (e) {
      const error = e as Error;
      this.hooksEngine.handleOrderPostponed({
        order: orderInfo,
        estimation: hookEstimation,
        context,
        reason: isRevertedError(error)
          ? OrderPostponedHookReason.FULFILLMENT_REVERTED
          : OrderPostponedHookReason.FULFILLMENT_FAILED,
        message: error.message,
      });
      logger.error(`fulfill transaction failed: ${e}`);
      logger.error(e);
      if (allowPlaceToMempool)
        this.mempoolService.addOrder({ orderInfo, context });
      return;
    }

    await this.waitIsOrderFulfilled(orderInfo.orderId, orderInfo.order, context, logger);

    // order is fulfilled, remove it from queues (the order may have come again thru WS)
    this.clearInternalQueues(orderInfo.orderId);

    // unlocking
    this.batchUnlocker.addOrder(orderInfo.orderId, orderInfo.order, context);
  }

  private async createOrderFullfillTx(
    orderId: string,
    order: OrderData,
    reserveDstToken: Uint8Array,
    reservedAmount: string,
    reserveToTakeSlippageBps: number | null,
    context: OrderProcessorContext,
    logger: Logger
  ) {
    let fullFillTxPayload: any;
    if (order.take.chainId === ChainId.Solana) {
      const wallet = (this.takeChain.fulfullProvider as SolanaProviderAdapter)
        .wallet.publicKey;
      fullFillTxPayload = {
        taker: wallet,
      };
    } else {
      fullFillTxPayload = {
        web3: this.takeChain.fulfullProvider.connection,
        permit: "0x",
        takerAddress: this.takeChain.fulfullProvider.address,
        unlockAuthority: this.takeChain.unlockProvider.address,
      };
    }
    fullFillTxPayload.swapConnector = context.config.swapConnector;
    fullFillTxPayload.reservedAmount = reservedAmount;
    fullFillTxPayload.slippageBps = reserveToTakeSlippageBps;
    fullFillTxPayload.loggerInstance = createClientLogger(logger);
    const fulfillTx = await context.config.client.preswapAndFulfillOrder(
      order,
      orderId,
      reserveDstToken,
      fullFillTxPayload
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
