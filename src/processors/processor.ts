import {
  calculateExpectedTakeAmount,
  ChainId,
  evm,
  optimisticSlippageBps,
  OrderData,
  tokenAddressToString,
} from "@debridge-finance/dln-client";
import { Logger } from "pino";
import Web3 from "web3";

import { OrderInfoStatus } from "../enums/order.info.status";
import { ProcessorParams } from "../interfaces";
import { createClientLogger } from "../logger";
import { EvmAdapterProvider } from "../providers/evm.provider.adapter";
import { SolanaProviderAdapter } from "../providers/solana.provider.adapter";

import { MempoolService } from "./mempool.service";
import {
  OrderProcessor,
  OrderProcessorContext,
  OrderProcessorInitContext,
  OrderProcessorInitializer,
} from "./order.processor";
import { approveToken } from "./utils/approve";

class PreswapProcessor extends OrderProcessor {
  private mempoolService: MempoolService;
  private internalNewOrderQueue = new Set<string>();
  private internalOldOrderQueue = new Set<string>();
  private ordersMap = new Map<string, ProcessorParams>();

  private isLocked: boolean = false;

  constructor(
    private readonly minProfitabilityBps: number,
    private readonly mempoolIntervalMs: number
  ) {
    super();
  }

  async init(
    chainId: ChainId,
    context: OrderProcessorInitContext
  ): Promise<void> {
    this.chainId = chainId;
    this.context = context;

    this.mempoolService = new MempoolService(
      context.logger,
      this.process.bind(this),
      this.mempoolIntervalMs
    );

    if (chainId !== ChainId.Solana) {
      const tokens: string[] = [];
      context.buckets.forEach((bucket) => {
        const tokensFromBucket = bucket.findTokens(this.chainId) || [];
        tokensFromBucket.forEach((token) => {
          tokens.push(tokenAddressToString(this.chainId, token));
        });
      });

      const client = context.takeChain.client as evm.PmmEvmClient;
      await Promise.all([
        ...tokens.map((token) =>
          approveToken(
            chainId,
            token,
            client.getContractAddress(
              chainId,
              evm.ServiceType.CrosschainForwarder
            ),
            context.takeChain.fulfullProvider as EvmAdapterProvider,
            context.logger
          )
        ),
        ...tokens.map((token) =>
          approveToken(
            chainId,
            token,
            client.getContractAddress(chainId, evm.ServiceType.Destination),
            context.takeChain.fulfullProvider as EvmAdapterProvider,
            context.logger
          )
        ),
      ]);
    }
  }

  async process(params: ProcessorParams): Promise<void> {
    const { context, orderInfo } = params;
    const { orderId, type } = orderInfo;
    const logger = context.logger.child({ processor: "preswapProcessor" });

    if (type === OrderInfoStatus.other) {
      const message = `Order is not supported`;
      logger.error(message);
      throw new Error(message);
    }

    // delete completed order
    if ([OrderInfoStatus.fulfilled, OrderInfoStatus.cancelled].includes(type)) {
      this.internalOldOrderQueue.delete(orderId);
      this.internalNewOrderQueue.delete(orderId);
      this.ordersMap.delete(orderId);
      logger.debug(`orderId ${orderId} is deleted from queue`);
      return;
    }
    if (this.isLocked) {
      if (type === OrderInfoStatus.archival) {
        this.internalOldOrderQueue.add(orderId);
      } else if (type === OrderInfoStatus.created) {
        this.internalNewOrderQueue.add(orderId);
      }
      this.ordersMap.set(orderId, params);
      logger.info(`Process is working`);
      return;
    }
    this.isLocked = true;

    try {
      await this.processOrder(params);
    } catch (e) {
      logger.error(`processing ${orderId} with error: ${e}`);
      this.mempoolService.addOrder({ orderInfo, context });
    }
    this.isLocked = false;

    // get next order new then old
    const nextOrderId =
      this.internalNewOrderQueue.values().next().value ||
      this.internalOldOrderQueue.values().next().value;

    if (nextOrderId) {
      this.process(this.ordersMap.get(nextOrderId)!);
    }

    // delete next order from quees
    this.internalNewOrderQueue.delete(nextOrderId);
    this.internalOldOrderQueue.delete(nextOrderId);
    this.ordersMap.delete(nextOrderId);
  }

  private async processOrder(params: ProcessorParams): Promise<void | never> {
    const { orderInfo, context } = params;
    const { orderId, order } = orderInfo;
    const logger = context.logger.child({ processor: "preswapProcessor" });
    const clientLogger = createClientLogger(logger);

    if (order === null) {
      const message = "order is empty";
      logger.error(message);
      throw new Error(message);
    }

    const bucket = context.config.buckets.find(
      (bucket) =>
        bucket.findFirstToken(order.give.chainId) !== undefined &&
        bucket.findFirstToken(order.take.chainId) !== undefined
    );
    if (bucket === undefined) {
      const message = "no token bucket effectively covering both chains";
      logger.error(message);
      throw new Error(message);
    }
    const { reserveDstToken, requiredReserveDstAmount, isProfitable } =
      await calculateExpectedTakeAmount(
        order,
        optimisticSlippageBps(),
        this.minProfitabilityBps,
        {
          client: context.config.client,
          giveConnection: context.giveChain.fulfullProvider.connection as Web3,
          takeConnection: this.context.takeChain.fulfullProvider
            .connection as Web3,
          priceTokenService: context.config.tokenPriceService,
          buckets: context.config.buckets,
          swapConnector: context.config.swapConnector,
          logger: clientLogger,
        }
      );

    if (!isProfitable) {
      const message = "order is not profitable, skipping";
      logger.error(message);
      throw new Error(message);
    }

    const fees = await this.getFee(order, context);
    const executionFeeAmount = await context.config.client.getAmountToSend(
      order.take.chainId,
      order.give.chainId,
      fees.executionFees.total,
      this.context.takeChain.fulfullProvider.connection as Web3
    );
    logger.debug(`executionFeeAmount=${JSON.stringify(executionFeeAmount)}`);

    // fulfill order
    const fulfillTx = await this.createOrderFullfillTx(
      orderId,
      order,
      reserveDstToken,
      requiredReserveDstAmount,
      context,
      logger
    );

    try {
      const txFulfill =
        await this.context.takeChain.fulfullProvider.sendTransaction(
          fulfillTx.tx,
          { logger }
        );
      logger.info(`fulfill transaction ${txFulfill} is completed`);
    } catch (e) {
      console.error(e);
      const message = `fulfill transaction failed: ${e}`;
      logger.error(message);
      throw new Error(message);
    }
    await this.waitIsOrderFulfilled(orderId, order, context, logger);

    const beneficiary = context.giveChain.beneficiary;

    const unlockTx = await this.createOrderUnlockTx(
      orderId,
      order,
      beneficiary,
      executionFeeAmount,
      fees,
      context,
      logger
    );
    const txUnlock =
      await this.context.takeChain.unlockProvider.sendTransaction(unlockTx, {
        logger,
      });
    logger.info(`unlock transaction ${txUnlock} is completed`);
  }

  private async createOrderUnlockTx(
    orderId: string,
    order: OrderData,
    beneficiary: string,
    executionFeeAmount: bigint,
    fees: any,
    context: OrderProcessorContext,
    logger: Logger
  ) {
    // todo fix any
    let unlockTxPayload: any;
    if (order.take.chainId === ChainId.Solana) {
      const wallet = (
        this.context.takeChain.unlockProvider as SolanaProviderAdapter
      ).wallet.publicKey;
      unlockTxPayload = {
        unlocker: wallet,
      };
    } else {
      const rewards =
        order.give.chainId === ChainId.Solana
          ? {
              reward1: fees.executionFees.rewards[0].toString(),
              reward2: fees.executionFees.rewards[1].toString(),
            }
          : {
              reward1: "0",
              reward2: "0",
            };
      unlockTxPayload = {
        web3: (this.context.takeChain.unlockProvider as EvmAdapterProvider)
          .connection,
        ...rewards,
      };
    }
    unlockTxPayload.loggerInstance = createClientLogger(logger);

    const unlockTx =
      await context.config.client.sendUnlockOrder<ChainId.Solana>(
        order,
        orderId,
        beneficiary,
        executionFeeAmount,
        unlockTxPayload
      );
    logger.debug(
      `unlockTx is created in ${order.take.chainId} ${JSON.stringify(unlockTx)}`
    );

    return unlockTx;
  }

  private async createOrderFullfillTx(
    orderId: string,
    order: OrderData,
    reserveDstToken: Uint8Array,
    reservedAmount: string,
    context: OrderProcessorContext,
    logger: Logger
  ) {
    let fullFillTxPayload: any;
    if (order.take.chainId === ChainId.Solana) {
      const wallet = (
        this.context.takeChain.fulfullProvider as SolanaProviderAdapter
      ).wallet.publicKey;
      fullFillTxPayload = {
        taker: wallet,
      };
    } else {
      fullFillTxPayload = {
        web3: this.context.takeChain.fulfullProvider.connection,
        permit: "0x",
        takerAddress: this.context.takeChain.fulfullProvider.address,
        unlockAuthority: this.context.takeChain.unlockProvider.address,
      };
    }
    fullFillTxPayload.swapConnector = context.config.swapConnector;
    fullFillTxPayload.reservedAmount = reservedAmount;
    fullFillTxPayload.slippageBps = optimisticSlippageBps();
    fullFillTxPayload.loggerInstance = createClientLogger(logger);
    const fulfillTx = await context.config.client.preswapAndFulfillOrder(
      order,
      orderId,
      reserveDstToken,
      fullFillTxPayload
    );
    logger.debug(
      `fulfillTx is created in ${order.take.chainId} ${JSON.stringify(
        fulfillTx
      )}`
    );

    return fulfillTx;
  }
}

export const processor = (
  minProfitabilityBps: number,
  mempoolIntervalMs: number = 30_000
): OrderProcessorInitializer => {
  return async (chainId: ChainId, context: OrderProcessorInitContext) => {
    const processor = new PreswapProcessor(
      minProfitabilityBps,
      mempoolIntervalMs
    );
    await processor.init(chainId, context);
    return processor;
  };
};
