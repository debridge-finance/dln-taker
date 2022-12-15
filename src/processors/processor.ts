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

    this.mempoolService = new MempoolService(context.logger);
    setInterval(() => {
      this.mempoolService.process();
    }, this.mempoolIntervalMs);

    if (chainId !== ChainId.Solana) {
      const tokens: string[] = [];
      context.buckets.forEach((bucket) => {
        (bucket.findTokens(this.chainId) || []).forEach((token) => {
          tokens.push(tokenAddressToString(this.chainId, token));
        });
      });

      const client = context.chain.client as evm.PmmEvmClient;
      await Promise.all([
        ...tokens.map((token) =>
          approveToken(
            chainId,
            token,
            client.getContractAddress(
              chainId,
              evm.ServiceType.CrosschainForwarder
            ),
            context.chain.fulfullProvider as EvmAdapterProvider,
            context.logger
          )
        ),
        ...tokens.map((token) =>
          approveToken(
            chainId,
            token,
            client.getContractAddress(chainId, evm.ServiceType.Destination),
            context.chain.fulfullProvider as EvmAdapterProvider,
            context.logger
          )
        ),
      ]);
    }
  }

  async process(
    orderId: string,
    order: OrderData,
    context: OrderProcessorContext
  ): Promise<boolean> {
    const logger = context.logger.child({ processor: "preswapProcessor" });
    const clientLogger = createClientLogger(logger);

    const bucket = context.config.buckets.find(
      (bucket) =>
        bucket.findFirstToken(order.give.chainId) !== undefined &&
        bucket.findFirstToken(order.take.chainId) !== undefined
    );
    if (bucket === undefined) {
      logger.info("no token bucket effectively covering both chains");
      return false;
    }
    const { reserveDstToken, requiredReserveDstAmount, isProfitable } =
      await calculateExpectedTakeAmount(
        order,
        optimisticSlippageBps(),
        this.minProfitabilityBps,
        {
          client: context.config.client,
          giveConnection: context.giveChain.fulfullProvider.connection as Web3,
          takeConnection: context.takeChain.fulfullProvider.connection as Web3,
          priceTokenService: context.config.tokenPriceService,
          buckets: context.config.buckets,
          swapConnector: context.config.swapConnector,
          logger: clientLogger,
        }
      );

    if (!isProfitable) {
      logger.info("order is not profitable, skipping");
      this.mempoolService.addOrder({
        params: { orderId, order, context },
        orderProcessor: this,
      });
      return false;
    }

    const fees = await this.getFee(order, context);
    const executionFeeAmount = await context.config.client.getAmountToSend(
      order.take.chainId,
      order.give.chainId,
      fees.executionFees.total,
      context.takeChain.fulfullProvider.connection as Web3
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
    if (context.orderFulfilledMap.has(orderId)) {
      context.orderFulfilledMap.delete(orderId);
      logger.error(`transaction is fulfilled`);
      return false;
    }

    try {
      const txFulfill = await context.takeChain.fulfullProvider.sendTransaction(
        fulfillTx.tx,
        { logger }
      );
      logger.info(`fulfill transaction ${txFulfill} is completed`);
    } catch (e) {
      console.error(e);
      logger.error(`fulfill transaction failed: ${e}`);
      return false;
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
    const txUnlock = await context.takeChain.unlockProvider.sendTransaction(
      unlockTx,
      { logger }
    );
    logger.info(`unlock transaction ${txUnlock} is completed`);

    return true;
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
      const wallet = (context.takeChain.unlockProvider as SolanaProviderAdapter)
        .wallet.publicKey;
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
        web3: (context.takeChain.unlockProvider as EvmAdapterProvider)
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
        context.takeChain.fulfullProvider as SolanaProviderAdapter
      ).wallet.publicKey;
      fullFillTxPayload = {
        taker: wallet,
      };
    } else {
      fullFillTxPayload = {
        web3: context.takeChain.fulfullProvider.connection,
        permit: "0x",
        takerAddress: context.takeChain.fulfullProvider.address,
        unlockAuthority: context.takeChain.unlockProvider.address,
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
