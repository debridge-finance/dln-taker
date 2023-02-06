import {
  calculateExpectedTakeAmount,
  ChainId,
  evm,
  OrderData,
  OrderState,
  tokenAddressToString,
} from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";
import { Logger } from "pino";
import Web3 from "web3";

import { OrderInfoStatus } from "../enums/order.info.status";
import { IncomingOrderContext } from "../interfaces";
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

export type UniversalProcessorParams = {
  minProfitabilityBps: number;
  mempoolInterval: number;
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

    const logger = context.logger.child({
      processor: "universal",
      takeChainId: chainId,
    });

    this.batchUnlocker = new BatchUnlocker(
      logger,
      this.takeChain,
      this.params.batchUnlockSize
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
    const { orderId, type, order } = orderInfo;

    params.context.logger = context.logger.child({
      processor: "universal",
      orderId,
    });

    switch (type) {
      case OrderInfoStatus.ArchivalCreated:
      case OrderInfoStatus.Created: {
        return this.tryProcess(params);
      }
      case OrderInfoStatus.ArchivalFulfilled: {
        this.batchUnlocker.unlockOrder(orderId, order!, context);
        return;
      }
      case OrderInfoStatus.Cancelled: {
        this.queue.delete(orderId);
        this.priorityQueue.delete(orderId);
        this.incomingOrdersMap.delete(orderId);
        this.mempoolService.delete(orderId);
        context.logger.debug(`deleted from queues`);
        return;
      }
      case OrderInfoStatus.Fulfilled: {
        this.queue.delete(orderId);
        this.priorityQueue.delete(orderId);
        this.incomingOrdersMap.delete(orderId);
        this.mempoolService.delete(orderId);
        context.logger.debug(`deleted from queues`);
        this.batchUnlocker.unlockOrder(orderId, order!, context);
        return;
      }
      case OrderInfoStatus.Other:
      default: {
        context.logger.error(
          `status=${OrderInfoStatus[type]} not implemented, skipping`
        );
        return;
      }
    }
  }

  private async tryProcess(params: IncomingOrderContext): Promise<void> {
    const { context, orderInfo } = params;
    const { orderId } = orderInfo;

    // already processing an order
    if (this.isLocked) {
      context.logger.debug(
        `Processor is currently processing an order, postponing`
      );

      switch (params.orderInfo.type) {
        case OrderInfoStatus.ArchivalCreated: {
          this.queue.add(orderId);
          context.logger.debug(`postponed to secondary queue`);
          break;
        }
        case OrderInfoStatus.Created: {
          this.priorityQueue.add(orderId);
          context.logger.debug(`postponed to primary queue`);
          break;
        }
        default:
          throw new Error(
            `Unexpected order status: ${OrderInfoStatus[params.orderInfo.type]}`
          );
      }
      this.incomingOrdersMap.set(orderId, params);
      return;
    }

    // process this order
    this.isLocked = true;
    try {
      await this.processOrder(params);
    } catch (e) {
      context.logger.error(`processing order failed with error: ${e}`);
      context.logger.error(e);
    }
    this.isLocked = false;

    // forward to the next order
    // TODO try to get rid of recursion here. Use setInterval?
    const nextOrder = this.pickNextOrder();
    if (nextOrder) {
      this.tryProcess(nextOrder);
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
    params: IncomingOrderContext
  ): Promise<void | never> {
    const { orderInfo, context } = params;
    const { orderId, order } = orderInfo;
    const logger = params.context.logger;

    if (!order || !orderId) {
      logger.error("order is empty, should not happen");
      return;
    }

    const bucket = context.config.buckets.find(
      (bucket) =>
        bucket.isOneOf(order.give.chainId, order.give.tokenAddress) &&
        bucket.findFirstToken(order.take.chainId) !== undefined
    );
    if (bucket === undefined) {
      logger.info(
        `no bucket found to cover order's give token: ${tokenAddressToString(
          order.give.chainId,
          order.give.tokenAddress
        )}, skipping`
      );
      return;
    }

    // validate that order is not fullfilled
    const takeOrderStatus = await context.config.client.getTakeOrderStatus(
      orderId,
      params.orderInfo.order!.take.chainId,
      { web3: this.takeChain.fulfullProvider.connection as Web3 }
    );
    if (
      takeOrderStatus?.status !== OrderState.NotSet &&
      takeOrderStatus?.status !== undefined
    ) {
      logger.info("order is already handled on the give chain, skipping");
      return;
    }

    // validate that order is created
    const giveOrderStatus = await context.config.client.getGiveOrderStatus(
      params.orderInfo.orderId,
      params.orderInfo.order!.give.chainId,
      { web3: context.giveChain.fulfullProvider.connection as Web3 }
    );
    if (giveOrderStatus?.status !== OrderState.Created) {
      logger.info("inexistent order, skipping");
      return;
    }

    const batchSize =
      order.give.chainId === ChainId.Solana ||
      order.take.chainId === ChainId.Solana
        ? null
        : this.params.batchUnlockSize;

    const {
      reserveDstToken,
      requiredReserveDstAmount,
      isProfitable,
      reserveToTakeSlippageBps,
    } = await calculateExpectedTakeAmount(
      order,
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

    if (!isProfitable) {
      logger.info("order is not profitable, postponing it to the mempool");
      this.mempoolService.addOrder({ orderInfo, context });
      return;
    }

    const accountReserveBalance =
      await this.takeChain.fulfullProvider.getBalance(reserveDstToken);

    if (new BigNumber(accountReserveBalance).lt(requiredReserveDstAmount)) {
      logger.info(
        `not enough reserve token on balance: ${accountReserveBalance} actual, but expected ${requiredReserveDstAmount}; postponing it to the mempool`
      );
      this.mempoolService.addOrder({ orderInfo, context });
      return;
    }

    // fulfill order
    const fulfillTx = await this.createOrderFullfillTx(
      orderId,
      order,
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
      logger.info(`fulfill transaction ${txFulfill} is completed`);
    } catch (e) {
      logger.error(`fulfill transaction failed: ${e}`);
      logger.error(e);
      this.mempoolService.addOrder({ orderInfo, context });
      return;
    }

    await this.waitIsOrderFulfilled(orderId, order, context, logger);

    // unlocking
    this.batchUnlocker.unlockOrder(orderId, order, context);
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
