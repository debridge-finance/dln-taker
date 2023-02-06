import {
  buffersAreEqual,
  ChainId,
  OrderData,
  OrderEstimationStage,
  OrderState,
  tokenAddressToString,
  tokenStringToBuffer,
} from "@debridge-finance/dln-client";
import { Logger } from "pino";
import Web3 from "web3";

import {
  ExecutorInitializingChain,
  ExecutorSupportedChain,
  IExecutor,
} from "../executors/executor";
import { createClientLogger } from "../logger";
import { EvmProviderAdapter } from "../providers/evm.provider.adapter";
import { SolanaProviderAdapter } from "../providers/solana.provider.adapter";

import { OrderProcessorContext, OrderProcessorInitContext } from "./base";

export class BatchUnlocker {
  private ordersDataMap = new Map<string, OrderData>(); // orderId => orderData
  private unlockBatchesOrderIdMap = new Map<ChainId, Set<string>>(); // chainId => orderId[]
  private isBatchUnlockLocked: boolean = false;
  private readonly logger: Logger;
  private executor: IExecutor;

  constructor(
    logger: Logger,
    private readonly takeChain: ExecutorInitializingChain,
    private readonly batchUnlockSize: number
  ) {
    this.logger = logger.child({
      service: "batchUnlock",
      takeChainId: this.takeChain.chain,
      batchUnlockSize
    });
  }

  async unlockOrder(
    orderId: string,
    order: OrderData,
    context: OrderProcessorContext
  ): Promise<void> {
    this.executor = context.config;

    // validate current order state:
    const orderState = await this.executor.client.getTakeOrderStatus(
      orderId,
      order.take.chainId,
      { web3: this.takeChain.fulfullProvider.connection as Web3 }
    );
    // order must be in the FULFILLED state
    if (orderState?.status !== OrderState.Fulfilled) {
      context.logger.debug(`current state is ${ orderState?.status }, however OrderState.Fulfilled is expected; not adding to the batch unlock pool`);
      return;
    }
    // a FULFILLED order must have ours takerAddress to ensure successful unlock
    const takerAddress = tokenStringToBuffer(this.takeChain.chain, orderState.takerAddress);
    const unlockAuthority = tokenStringToBuffer(this.takeChain.chain, this.executor.chains[this.takeChain.chain]!.unlockProvider.address);
    if (!buffersAreEqual(takerAddress, unlockAuthority)) {
      context.logger.debug(
        `orderState.takerAddress (${orderState.takerAddress}) does not match expected unlockAuthority (${tokenAddressToString(this.takeChain.chain, unlockAuthority)}), not adding to the batch unlock pool`
      );
      return;
    }

    // filling batch queue
    if (!this.unlockBatchesOrderIdMap.has(order.give.chainId)) {
      this.unlockBatchesOrderIdMap.set(order.give.chainId, new Set());
    }
    this.unlockBatchesOrderIdMap.get(order.give.chainId)!.add(orderId);
    this.ordersDataMap.set(orderId, order);

    context.logger.debug(`added to the batch unlock queue`);
    this.logger.debug(`batch unlock queue size for the giveChain=${ChainId[order.give.chainId]} ${this.unlockBatchesOrderIdMap.get(order.give.chainId)!.size} order(s)`);

    return this.tryUnlock(order.give.chainId);
  }

  async tryUnlock(giveChainId: ChainId) {
    // check that process is blocked
    if (this.isBatchUnlockLocked) {
      this.logger.debug("batch unlock processing is locked, not performing unlock procedures");
      return;
    }

    const currentSize = this.unlockBatchesOrderIdMap.get(giveChainId)!.size;
    if (currentSize < this.batchUnlockSize) {
      this.logger.debug("batch is not fulled yet, not performing unlock procedures")
      return;
    }

    this.isBatchUnlockLocked = true;
    this.logger.debug(`trying to send batch unlock to ${ChainId[giveChainId]}`)
    const batchSucceeded = await this.performBatchUnlock(giveChainId);
    if (batchSucceeded) {
      this.logger.debug(`succeeded sending batch to ${ChainId[giveChainId]}, checking other directions`)
      await this.unlockAny();
    }
    else {
      this.logger.error("batch unlock failed, stopping unlock procedures");
    }
    this.isBatchUnlockLocked = false;
  }

  private async unlockAny() {
    let giveChainId: ChainId | undefined;
    while (giveChainId = this.peekNextBatch()) {
      this.logger.debug(`trying to send batch unlock to ${ChainId[giveChainId]}`)
      const batchSucceeded = await this.performBatchUnlock(giveChainId);
      if (!batchSucceeded) {
        this.logger.error("batch unlock failed, stopping");
        break;
      }
    }
  }

  private peekNextBatch() {
    for (const [
      chainId,
      orderIds,
    ] of this.unlockBatchesOrderIdMap.entries()) {
      if (orderIds.size >= this.batchUnlockSize) {
        return chainId
      }
    }
  }

  private async performBatchUnlock(chainId: ChainId) {
    const orderIds = Array.from(
      this.unlockBatchesOrderIdMap.get(chainId)!
    ).slice(0, this.batchUnlockSize);

    const unlockedOrders = await this.unlockOrders(chainId, orderIds);

    // clean executed orders form queue
    unlockedOrders.forEach((id) => {
      this.unlockBatchesOrderIdMap.get(chainId)!.delete(id);
      this.ordersDataMap.delete(id);
    });

    return unlockedOrders.length === this.batchUnlockSize
  }

  private async unlockOrders(
    giveChainId: ChainId,
    orderIds: string[],
  ): Promise<string[]> {
    const unlockedOrders = [];
    const logger = this.logger.child({
      giveChainId,
    });

    logger.info(`picked ${orderIds.length} orders to unlock`);
    logger.debug(orderIds.join(","));

    const giveChain = this.executor.chains[giveChainId];
    if (!giveChain) throw new Error(`Give chain not set: ${ChainId[giveChainId]}`);

    const [giveNativePrice, takeNativePrice] = await Promise.all([
      this.executor.tokenPriceService.getPrice(giveChainId, null, {
        logger: createClientLogger(logger),
      }),
      this.executor.tokenPriceService.getPrice(this.takeChain.chain, null, {
        logger: createClientLogger(logger),
      }),
    ]);

    if (
      giveChainId === ChainId.Solana ||
      this.takeChain.chain === ChainId.Solana
    ) {
      unlockedOrders.push(
        ...(await this.unlockSolanaBatchOrders(
          giveNativePrice,
          takeNativePrice,
          giveChain,
          orderIds,
          logger
        ))
      );
    } else {
      unlockedOrders.push(
        ...(await this.unlockEvmBatchOrders(
          giveNativePrice,
          takeNativePrice,
          giveChain,
          orderIds,
          logger
        ))
      );
    }
    return unlockedOrders;
  }

  private async unlockEvmBatchOrders(
    giveNativePrice: number,
    takeNativePrice: number,
    giveChain: ExecutorSupportedChain,
    orderIds: string[],
    logger: Logger
  ) {
    const beneficiary = giveChain.beneficiary;

    try {
      const { total: executionFeeAmount } =
        await this.executor.client.getClaimBatchUnlockExecutionFee(
          orderIds.length,
          giveChain.chain,
          this.takeChain.chain,
          giveNativePrice,
          takeNativePrice,
          {
            giveWeb3: (giveChain.unlockProvider! as EvmProviderAdapter)
              .connection,
            takeWeb3: (this.takeChain.unlockProvider as EvmProviderAdapter)
              .connection,
            orderEstimationStage: OrderEstimationStage.OrderFulfillment,
            loggerInstance: createClientLogger(logger),
          }
        );

      const batchUnlockTx = await this.executor.client.sendBatchUnlock(
        Array.from(orderIds),
        giveChain.chain,
        this.takeChain.chain,
        beneficiary,
        executionFeeAmount,
        {
          web3: (this.takeChain.unlockProvider as EvmProviderAdapter)
            .connection,
          loggerInstance: createClientLogger(logger),
          reward1: 0,
          reward2: 0,
        }
      );

      await this.takeChain.unlockProvider.sendTransaction(
        batchUnlockTx,
        {
          logger,
        }
      );

      logger.info(`unlocked orders: ${orderIds.join(",")}`);
      return orderIds;
    } catch (e) {
      logger.error(`failed to unlock ${orderIds.length} order(s): ${e}`);
      logger.error(`failed batch contained: ${orderIds.join(",")}`)
      logger.error(e);
      return [];
    }
  }

  private async unlockSolanaBatchOrders(
    giveNativePrice: number,
    takeNativePrice: number,
    giveChain: ExecutorSupportedChain,
    orderIds: string[],
    logger: Logger
  ): Promise<string[]> {
    const unlockedOrders = [];
    // execute unlock for each order(solana doesnt support batch unlock now)
    for (const orderId of orderIds) {
      try {
        await this.unlockSolanaOrder(
          giveNativePrice,
          takeNativePrice,
          giveChain,
          orderId,
          logger
        );
        unlockedOrders.push(orderId);
      } catch (e) {
        logger.error(`failed to unlock ${orderId} order: ${e}`);
        logger.error(e);
      }
    }
    return unlockedOrders;
  }

  private async unlockSolanaOrder(
    giveNativePrice: number,
    takeNativePrice: number,
    giveChain: ExecutorSupportedChain,
    orderId: string,
    logger: Logger
  ) {
    const beneficiary = giveChain.beneficiary;
    const order = this.ordersDataMap.get(orderId)!;

    const { total: executionFeeAmount, rewards } =
      await this.executor.client.getClaimUnlockExecutionFee(
        giveChain.chain,
        this.takeChain.chain,
        giveNativePrice,
        takeNativePrice,
        {
          giveWeb3: (giveChain.unlockProvider as EvmProviderAdapter)
            .connection,
          takeWeb3: (this.takeChain.unlockProvider as EvmProviderAdapter)
            .connection,
          orderEstimationStage: OrderEstimationStage.OrderFulfillment,
          loggerInstance: createClientLogger(logger),
        }
      );
    const unlockTx = await this.createOrderUnlockTx(
      orderId,
      order,
      beneficiary,
      executionFeeAmount,
      rewards,
      logger
    );

    await this.takeChain.unlockProvider.sendTransaction(
      unlockTx,
      {
        logger
      }
    );
    logger.info(`unlocked order: ${orderId}`);
  }

  private async createOrderUnlockTx(
    orderId: string,
    order: OrderData,
    beneficiary: string,
    executionFeeAmount: bigint,
    rewards: bigint[],
    logger: Logger
  ) {
    // todo fix any
    let unlockTxPayload: any;
    if (order.take.chainId === ChainId.Solana) {
      const wallet = (
        this.takeChain.unlockProvider as SolanaProviderAdapter
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
        web3: (this.takeChain.unlockProvider as EvmProviderAdapter)
          .connection,
        ...rewardsParams,
      };
    }
    unlockTxPayload.loggerInstance = createClientLogger(logger);

    await this.executor.client.sendUnlockOrder<ChainId.Solana>(
      order,
      orderId,
      beneficiary,
      executionFeeAmount,
      unlockTxPayload
    );
  }
}
