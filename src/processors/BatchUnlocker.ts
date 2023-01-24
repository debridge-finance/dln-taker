import {
  ChainId,
  OrderData,
  PMMClient,
  PriceTokenService,
} from "@debridge-finance/dln-client";
import { Logger } from "pino";

import {
  ExecutorInitializingChain,
  ExecutorSupportedChain,
} from "../executors/executor";
import { createClientLogger } from "../logger";
import { EvmProviderAdapter } from "../providers/evm.provider.adapter";
import { SolanaProviderAdapter } from "../providers/solana.provider.adapter";

import { OrderProcessorContext, OrderProcessorInitContext } from "./base";

type BatchUnlockerContext = {
  logger: Logger;
  priceTokenService: PriceTokenService;
  client: PMMClient;
  giveChain: ExecutorSupportedChain;
};

export class BatchUnlocker {
  private ordersDataMap = new Map<string, OrderData>(); // key orderid, contains order data(user for batch unlock)
  private unlockBatchesOrderIdMap = new Map<ChainId, Set<string>>(); // contains batch of orderid for unlock
  private isBatchUnlockLocked: boolean = false;
  private readonly takeChain: ExecutorInitializingChain;
  private readonly logger: Logger;
  private readonly giveChainsMap = new Map<ChainId, ExecutorSupportedChain>();

  constructor(
    private readonly context: OrderProcessorInitContext,
    private readonly batchUnlockSize: number
  ) {
    this.takeChain = context.takeChain;
    this.logger = context.logger;
  }

  unlockOrder(
    orderId: string,
    order: OrderData,
    context: OrderProcessorContext
  ) {
    const giveChain = order.give.chainId;
    // filling batch queue
    let orderIds = this.unlockBatchesOrderIdMap.get(giveChain);
    if (!orderIds) {
      orderIds = new Set();
    }
    orderIds.add(orderId);
    this.unlockBatchesOrderIdMap.set(giveChain, orderIds);
    this.ordersDataMap.set(orderId, order);

    // check that process is blocked
    if (this.isBatchUnlockLocked) {
      this.context.logger.debug("batch unlock processing is locked");
      return;
    }

    // execute batch unlock processing for full batch
    if (orderIds.size >= this.batchUnlockSize) {
      this.isBatchUnlockLocked = true; // lock batch unlock locker
      this.giveChainsMap.set(context.giveChain.chain, context.giveChain);
      const logger = this.logger.child({
        func: "performBatchUnlock",
        giveChain,
      });
      this.performBatchUnlock({
        logger,
        priceTokenService: context.config.tokenPriceService,
        client: context.config.client,
        giveChain: context.giveChain,
      });
    }
  }

  private async performBatchUnlock(context: BatchUnlockerContext) {
    const logger = context.logger;
    logger.info("Batch unlocking is started");

    const orderIds = Array.from(
      this.unlockBatchesOrderIdMap.get(context.giveChain.chain)!
    ).slice(0, this.batchUnlockSize);

    const unlockedOrders = await this.tryUnlockBatch(orderIds, context);

    // clean executed orders form queue
    unlockedOrders.forEach((id) => {
      this.unlockBatchesOrderIdMap.get(context.giveChain.chain)!.delete(id);
      this.ordersDataMap.delete(id);
    });

    // check a full of batch
    if (unlockedOrders.length === this.batchUnlockSize) {
      for (const [
        chainId,
        orderIds,
      ] of this.unlockBatchesOrderIdMap.entries()) {
        if (orderIds.size >= this.batchUnlockSize) {
          const currentChain = this.giveChainsMap.get(chainId)!;
          const logger = this.logger.child({
            func: "performBatchUnlock",
            giveChain: chainId,
          });
          this.performBatchUnlock({
            ...context,
            logger,
            giveChain: currentChain,
          }); // start unlocking for not full batch
          return;
        }
      }
    }

    // unlock batch process if each chain is not full
    this.isBatchUnlockLocked = false;
  }

  private async tryUnlockBatch(
    orderIds: string[],
    context: BatchUnlockerContext
  ): Promise<string[]> {
    const unlockedOrders = [];
    const clientLogger = createClientLogger(context.logger);
    const [giveNativePrice, takeNativePrice] = await Promise.all([
      context.priceTokenService.getPrice(context.giveChain.chain, null, {
        logger: clientLogger,
      }),
      context.priceTokenService.getPrice(this.takeChain.chain, null, {
        logger: clientLogger,
      }),
    ]);
    if (
      context.giveChain.chain === ChainId.Solana ||
      this.takeChain.chain === ChainId.Solana
    ) {
      unlockedOrders.push(
        ...(await this.unlockSolanaBatchOrders(
          giveNativePrice,
          takeNativePrice,
          orderIds,
          context
        ))
      );
    } else {
      unlockedOrders.push(
        ...(await this.unlockEvmBatchOrders(
          giveNativePrice,
          takeNativePrice,
          orderIds,
          context
        ))
      );
    }
    return unlockedOrders;
  }

  private async unlockEvmBatchOrders(
    giveNativePrice: number,
    takeNativePrice: number,
    orderIds: string[],
    context: BatchUnlockerContext
  ) {
    const beneficiary = context.giveChain.beneficiary;

    try {
      const { total: executionFeeAmount } =
        await context.client.getClaimBatchUnlockExecutionFee(
          orderIds.length,
          context.giveChain.chain,
          this.takeChain.chain,
          giveNativePrice,
          takeNativePrice,
          {
            giveWeb3: (context.giveChain.unlockProvider! as EvmProviderAdapter)
              .connection,
            takeWeb3: (this.takeChain.unlockProvider as EvmProviderAdapter)
              .connection,
            orderEstimationStage: 1, //todo
            loggerInstance: createClientLogger(context.logger),
          }
        );
      context.logger.debug(
        `executionFeeAmount = ${executionFeeAmount.toString()}`
      );
      const batchUnlockTx = await context.client.sendBatchUnlock(
        Array.from(orderIds),
        context.giveChain.chain,
        this.takeChain.chain,
        beneficiary,
        executionFeeAmount,
        {
          web3: (this.context.takeChain.unlockProvider as EvmProviderAdapter)
            .connection,
          loggerInstance: createClientLogger(context.logger),
          reward1: 0,
          reward2: 0,
        }
      );

      const txUnlock =
        await this.context.takeChain.unlockProvider.sendTransaction(
          batchUnlockTx,
          {
            logger: context.logger,
          }
        );

      context.logger.info(
        `unlock for ${JSON.stringify(
          Array.from(orderIds)
        )} orders ${txUnlock} is completed`
      );

      return orderIds;
    } catch (e) {
      context.logger.error(
        `Error in unlocking batch ${JSON.stringify(orderIds)}: ${e}`
      );
      return [];
    }
  }

  private async unlockSolanaBatchOrders(
    giveNativePrice: number,
    takeNativePrice: number,
    orderIds: string[],
    context: BatchUnlockerContext
  ): Promise<string[]> {
    const unlockedOrders = [];
    // execute unlock for each order(solana doesnt support batch unlock now)
    for (const orderId of orderIds) {
      try {
        await this.unlockSolanaOrder(
          context.giveChain.chain,
          giveNativePrice,
          takeNativePrice,
          orderId,
          context
        );
        unlockedOrders.push(orderId);
      } catch (e) {
        context.logger.error(`Error in unlocking order ${orderId}: ${e}`);
      }
    }
    return unlockedOrders;
  }

  private async unlockSolanaOrder(
    giveChain: ChainId,
    giveNativePrice: number,
    takeNativePrice: number,
    orderId: string,
    context: BatchUnlockerContext
  ) {
    const beneficiary = context.giveChain.beneficiary;
    const order = this.ordersDataMap.get(orderId)!;

    const { total: executionFeeAmount, rewards } =
      await context.client.getClaimUnlockExecutionFee(
        giveChain,
        this.takeChain.chain,
        giveNativePrice,
        takeNativePrice,
        {
          giveWeb3: (context.giveChain.unlockProvider as EvmProviderAdapter)
            .connection,
          takeWeb3: (this.takeChain.unlockProvider as EvmProviderAdapter)
            .connection,
          orderEstimationStage: 1,  //todo
          loggerInstance: createClientLogger(context.logger),
        }
      );
    context.logger.debug(
      `executionFeeAmount = ${executionFeeAmount.toString()}`
    );
    const unlockTx = await this.createOrderUnlockTx(
      orderId,
      order,
      beneficiary,
      executionFeeAmount,
      rewards,
      context,
      context.logger
    );

    const txUnlock =
      await this.context.takeChain.unlockProvider.sendTransaction(unlockTx, {
        logger: context.logger,
      });
    context.logger.info(`unlock transaction ${txUnlock} is completed`);
  }

  private async createOrderUnlockTx(
    orderId: string,
    order: OrderData,
    beneficiary: string,
    executionFeeAmount: bigint,
    rewards: bigint[],
    context: BatchUnlockerContext,
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
      const rewardsParams =
        order.give.chainId === ChainId.Solana
          ? {
              reward1: rewards[0].toString(),
              reward2: rewards[1].toString(),
            }
          : {
              reward1: "0",
              reward2: "0",
            };
      unlockTxPayload = {
        web3: (this.context.takeChain.unlockProvider as EvmProviderAdapter)
          .connection,
        ...rewardsParams,
      };
    }
    unlockTxPayload.loggerInstance = createClientLogger(logger);

    const unlockTx = await context.client.sendUnlockOrder<ChainId.Solana>(
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
}
