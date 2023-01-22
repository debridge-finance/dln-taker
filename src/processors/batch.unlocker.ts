import { ChainId, OrderData } from "@debridge-finance/dln-client";
import { Logger } from "pino";
import Web3 from "web3";

import { createClientLogger } from "../logger";
import { EvmProviderAdapter } from "../providers/evm.provider.adapter";
import { SolanaProviderAdapter } from "../providers/solana.provider.adapter";

import { OrderProcessorContext, OrderProcessorInitContext } from "./base";
import { UniversalProcessorParams } from "./universal";

export class BatchUnlocker {
  private ordersDataMap = new Map<string, OrderData>(); // key orderid, contains order data(user for batch unlock)
  private unlockBatchesOrderIdMap = new Map<ChainId, Set<string>>(); // contains batch of orderid for unlock
  private isBatchUnlockLocked: boolean = false;

  constructor(
    private readonly chainId: ChainId,
    private readonly context: OrderProcessorInitContext,
    private readonly params: UniversalProcessorParams
  ) {}

  private async performBatchUnlock(
    giveChain: ChainId,
    context: OrderProcessorContext
  ) {
    const logger = this.context.logger.child({
      func: "performBatchUnlock",
      giveChain,
    });
    logger.info("Batch unlocking is started");

    const orderIds = Array.from(
      this.unlockBatchesOrderIdMap.get(giveChain)!
    ).slice(0, this.params.batchUnlockSize);

    const { result, unlockedOrders } = await this.tryUnlockBatch(
      giveChain,
      orderIds,
      context
    );

    // clean executed orders form queue
    unlockedOrders.forEach((id) => {
      this.unlockBatchesOrderIdMap.get(giveChain)!.delete(id);
      this.ordersDataMap.delete(id);
    });

    // check a full of batch
    if (result) {
      for (const [
        chainId,
        orderIds,
      ] of this.unlockBatchesOrderIdMap.entries()) {
        if (orderIds.size >= this.params.batchUnlockSize) {
          this.performBatchUnlock(chainId, context); // start unlocking for not full batch
          return;
        }
      }
    }

    // unlock batch process if each chain is not full
    this.isBatchUnlockLocked = false;
  }

  private async tryUnlockBatch(
    giveChain: ChainId,
    orderIds: string[],
    context: OrderProcessorContext
  ): Promise<{ result: boolean; unlockedOrders: string[] }> {
    const logger = this.context.logger.child({
      func: "tryUnlockBatch",
      giveChain,
    });
    const unlockedOrders = [];
    try {
      const beneficiary = context.giveChain.beneficiary;
      if (giveChain === ChainId.Solana || this.chainId === ChainId.Solana) {
        // execute unlock for each order(solana doesnt support batch unlock now)
        for (const orderId of orderIds) {
          const order = this.ordersDataMap.get(orderId)!;
          const fees = await this.getFee(order, context);
          const executionFeeAmount =
            await context.config.client.getAmountToSend(
              this.chainId,
              giveChain,
              fees.executionFees.total,
              this.context.takeChain.fulfullProvider.connection as Web3
            );
          logger.debug(`executionFeeAmount = ${executionFeeAmount.toString()}`);
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
            await this.context.takeChain.unlockProvider.sendTransaction(
              unlockTx,
              {
                logger,
              }
            );
          unlockedOrders.push(orderId);
          logger.info(`unlock transaction ${txUnlock} is completed`);
        }
      } else {
        const order = this.ordersDataMap.get(orderIds[0])!;
        const fees = await this.getFee(order, context);
        const executionFeeAmount = await context.config.client.getAmountToSend(
          this.chainId,
          giveChain,
          fees.executionFees.total,
          this.context.takeChain.fulfullProvider.connection as Web3
        );
        logger.debug(`executionFeeAmount = ${executionFeeAmount.toString()}`);
        const batchUnlockTx = await context.config.client.sendBatchUnlock(
          Array.from(orderIds),
          giveChain,
          this.chainId,
          beneficiary,
          executionFeeAmount,
          {
            web3: (this.context.takeChain.unlockProvider as EvmProviderAdapter)
              .connection,
            loggerInstance: createClientLogger(logger),
            reward1: 0,
            reward2: 0,
          }
        );

        const txUnlock =
          await this.context.takeChain.unlockProvider.sendTransaction(
            batchUnlockTx,
            {
              logger,
            }
          );

        unlockedOrders.push(...orderIds);

        logger.info(
          `unlock for ${JSON.stringify(
            Array.from(orderIds)
          )} orders ${txUnlock} is completed`
        );
      }
    } catch (e) {
      logger.error(`Error in tryUnlockBatch: ${e}`);
      return {
        result: false,
        unlockedOrders,
      };
    }
    return {
      result: true,
      unlockedOrders,
    };
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
    if (orderIds.size >= this.params.batchUnlockSize) {
      this.isBatchUnlockLocked = true; // lock batch unlock locker
      this.performBatchUnlock(giveChain, context);
    }
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
        web3: (this.context.takeChain.unlockProvider as EvmProviderAdapter)
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

  private async getFee(order: OrderData, context: OrderProcessorContext) {
    const clientLogger = createClientLogger(context.logger);
    const [giveNativePrice, takeNativePrice] = await Promise.all([
      context.config.tokenPriceService.getPrice(order.give.chainId, null, {
        logger: clientLogger,
      }),
      context.config.tokenPriceService.getPrice(order.take.chainId, null, {
        logger: clientLogger,
      }),
    ]);
    const fees = await context.config.client.getTakerFlowCost(
      order,
      giveNativePrice,
      takeNativePrice,
      {
        giveWeb3: context.giveChain.fulfullProvider.connection as Web3,
        takeWeb3: this.context.takeChain.fulfullProvider.connection as Web3,
      }
    );
    context.logger.debug(`fees=${JSON.stringify(fees)}`);
    return fees;
  }
}
