import {
  buffersAreEqual,
  ChainId,
  OrderData,
  OrderEstimationStage,
  OrderState,
  tokenAddressToString,
} from '@debridge-finance/dln-client';
import { Logger } from 'pino';

import { helpers } from '@debridge-finance/solana-utils';
import {
  ExecutorInitializingChain,
  ExecutorSupportedChain,
  IExecutor,
} from '../executors/executor';
import { createClientLogger } from '../logger';

import { OrderProcessorContext } from './base';
import { HooksEngine } from '../hooks/HooksEngine';

export class BatchUnlocker {
  // max size fo unlocks coming to giveChain=Solana
  // TODO must be reimplemented so that batchSize can be set per giveChain, not per takeChain: #862kawqy0
  readonly #BATCH_UNLOCK_TO_SOLANA_MAX_SIZE = 7;

  readonly #BATCH_UNLOCK_TO_MAX_SIZE = 10;

  // @ts-ignore Initialized deferredly within the first call of the unlockOrder() method. Should be rewritten during the next major refactoring
  private executor: IExecutor;

  private ordersDataMap = new Map<string, OrderData>(); // orderId => orderData

  private unlockBatchesOrderIdMap = new Map<ChainId, Set<string>>(); // chainId => orderId[]

  #isBatchUnlockLocked: boolean = false;

  private readonly logger: Logger;

  constructor(
    logger: Logger,
    private readonly takeChain: ExecutorInitializingChain,
    private readonly batchUnlockSize: number,
    private readonly hooksEngine: HooksEngine,
    private readonly forceUnlockOrderUsdThreshold: number,
  ) {
    this.logger = logger.child({
      service: 'batchUnlock',
      takeChainId: this.takeChain.chain,
      batchUnlockSize,
    });
  }

  async unlockOrder(
    orderId: string,
    order: OrderData,
    context: OrderProcessorContext,
  ): Promise<void> {
    this.executor = context.config;

    // validate current order state:
    const orderState = await this.executor.client.getTakeOrderState(
      {
        orderId,
        takeChain: order.take.chainId,
      },
      {},
    );
    // order must be in the FULFILLED state
    if (orderState?.status !== OrderState.Fulfilled) {
      context.logger.debug(
        `current state is ${orderState?.status}, however OrderState.Fulfilled is expected; not adding to the batch unlock pool`,
      );
      return;
    }

    const unlockAuthority = this.executor.chains[this.takeChain.chain]!.unlockProvider.bytesAddress;
    // a FULFILLED order must have ours takerAddress to ensure successful unlock
    if (!buffersAreEqual(orderState.takerAddress, unlockAuthority)) {
      context.logger.debug(
        `orderState.takerAddress (${tokenAddressToString(
          this.takeChain.chain,
          orderState.takerAddress,
        )}) does not match expected unlockAuthority (${tokenAddressToString(
          this.takeChain.chain,
          unlockAuthority,
        )}), not adding to the batch unlock pool`,
      );
      return;
    }

    // filling batch queue
    this.addOrder(orderId, order, context);
  }

  private async addOrder(orderId: string, order: OrderData, context: OrderProcessorContext) {
    if (!this.unlockBatchesOrderIdMap.has(order.give.chainId)) {
      this.unlockBatchesOrderIdMap.set(order.give.chainId, new Set());
    }
    this.unlockBatchesOrderIdMap.get(order.give.chainId)!.add(orderId);
    this.ordersDataMap.set(orderId, order);

    context.logger.debug(`added to the batch unlock queue`);
    this.logger.debug(
      `batch unlock queue size for the giveChain=${ChainId[order.give.chainId]} ${
        this.unlockBatchesOrderIdMap.get(order.give.chainId)!.size
      } order(s)`,
    );

    const requiredOrderIds: Array<string> = [];
    const usdValueOfOrder = await this.executor.usdValueOfOrder(order);
    if (usdValueOfOrder >= this.forceUnlockOrderUsdThreshold) {
      requiredOrderIds.push(orderId);
    }

    this.tryUnlock(order.give.chainId, requiredOrderIds);
  }

  async tryUnlock(giveChainId: ChainId, requiredOrderIds: Array<string>): Promise<void> {
    // check that process is blocked
    if (this.#isBatchUnlockLocked) {
      this.logger.debug('batch unlock processing is locked, not performing unlock procedures');
      return;
    }

    const currentSize = this.unlockBatchesOrderIdMap.get(giveChainId)!.size;
    const minBatchUnlockSize =
      requiredOrderIds.length === 0 ? this.#getBatchUnlockSize(giveChainId) : 1;

    if (currentSize < minBatchUnlockSize) {
      this.logger.debug('batch is not fulled yet, not performing unlock procedures');
      return;
    }

    this.#isBatchUnlockLocked = true;
    this.logger.debug(`trying to send batch unlock to ${ChainId[giveChainId]}`);
    const batchSucceeded = await this.performBatchUnlock(giveChainId, requiredOrderIds);
    if (batchSucceeded) {
      this.logger.debug(
        `succeeded sending batch to ${ChainId[giveChainId]}, checking other directions`,
      );
      await this.unlockAny();
    } else {
      this.logger.error('batch unlock failed, stopping unlock procedures');
    }
    this.#isBatchUnlockLocked = false;
  }

  private async unlockAny(): Promise<void> {
    let giveChainId = this.peekNextBatch();
    while (giveChainId) {
      this.logger.debug(`trying to send batch unlock to ${ChainId[giveChainId]}`);
      // eslint-disable-next-line no-await-in-loop -- Intentional because we want to handle all available batches
      const batchSucceeded = await this.performBatchUnlock(giveChainId, []);
      if (batchSucceeded) {
        giveChainId = this.peekNextBatch();
      } else {
        this.logger.error('batch unlock failed, stopping');
        break;
      }
    }
  }

  private peekNextBatch(): ChainId | undefined {
    for (const [chainId, orderIds] of this.unlockBatchesOrderIdMap.entries()) {
      if (orderIds.size >= this.#getBatchUnlockSize(chainId)) {
        return chainId;
      }
    }

    return undefined;
  }

  /**
   * returns true if batch unlock succeeded (e.g. all orders were successfully unlocked)
   */
  private async performBatchUnlock(
    giveChainId: ChainId,
    requiredOrderIds: Array<string>,
  ): Promise<boolean> {
    const minBatchUnlockSize =
      requiredOrderIds.length === 0 ? this.#getBatchUnlockSize(giveChainId) : 1;
    const maxBatchUnlockSize = this.#getMaxBatchUnlockSize(giveChainId);

    const ordersToUnlock = Array.from(this.unlockBatchesOrderIdMap.get(giveChainId)!);

    const orderIdsForUnlock: Array<string> = [];
    let slicedOrderIds: Array<string> = requiredOrderIds;
    do {
      slicedOrderIds = ordersToUnlock.slice(
        orderIdsForUnlock.length,
        maxBatchUnlockSize - orderIdsForUnlock.length,
      );
      if (slicedOrderIds.length === 0) {
        break;
      }
      // eslint-disable-next-line no-await-in-loop -- Intentional because works one by one
      const orderIds = await this.getFulfilledOrders(slicedOrderIds);

      orderIdsForUnlock.push(...orderIds);
    } while (orderIdsForUnlock.length !== maxBatchUnlockSize || slicedOrderIds.length !== 0);

    this.logger.info(
      `Prepared batch for unlock: ${orderIdsForUnlock.join(
        ',',
      )}, required to unlock: ${requiredOrderIds.join(
        ',',
      )}, minBatchUnlockSize: ${minBatchUnlockSize}, maxBatchUnlockSize: ${maxBatchUnlockSize}`,
    );

    if (orderIdsForUnlock.length >= minBatchUnlockSize) {
      const unlockedOrders = await this.unlockOrders(giveChainId, orderIdsForUnlock);

      // clean executed orders form queue
      unlockedOrders.forEach((id) => {
        this.unlockBatchesOrderIdMap.get(giveChainId)!.delete(id);
        this.ordersDataMap.delete(id);
      });

      return unlockedOrders.length >= minBatchUnlockSize;
    }

    return false;
  }

  private async getFulfilledOrders(originalOrderIds: Array<string>) {
    const notUnlockedOrders: boolean[] = await Promise.all(
      originalOrderIds.map(async (orderId) => {
        const orderState = await this.executor.client.getTakeOrderState(
          {
            orderId,
            takeChain: this.takeChain.chain,
          },
          {},
        );

        return orderState?.status === OrderState.Fulfilled;
      }),
    );

    return originalOrderIds.filter((_, idx) => notUnlockedOrders[idx]);
  }

  private async unlockOrders(giveChainId: ChainId, orderIds: string[]): Promise<string[]> {
    const unlockedOrders: Array<string> = orderIds;
    const logger = this.logger.child({
      giveChainId,
      orderIds,
    });

    logger.info(`picked ${orderIds.length} orders to unlock`);
    logger.debug(orderIds.join(','));

    const giveChain = this.executor.chains[giveChainId];
    if (!giveChain) throw new Error(`Give chain not set: ${ChainId[giveChainId]}`);

    try {
      const sendBatchUnlockTransactionHash = await this.sendBatchUnlock(
        giveChain,
        orderIds,
        logger,
      );
      unlockedOrders.push(...orderIds);

      logger.info(
        `send_unlock tx (hash: ${sendBatchUnlockTransactionHash}) with ${
          orderIds.length
        } orders: ${orderIds.join(', ')}`,
      );

      this.hooksEngine.handleOrderUnlockSent({
        fromChainId: this.takeChain.chain,
        toChainId: giveChain.chain,
        txHash: sendBatchUnlockTransactionHash,
        orderIds,
      });
    } catch (e) {
      const error = e as Error;
      this.hooksEngine.handleOrderUnlockFailed({
        fromChainId: this.takeChain.chain,
        toChainId: giveChain.chain,
        message: `trying to unlock ${orderIds.length} orders from ${
          ChainId[this.takeChain.chain]
        } to ${ChainId[giveChain.chain]} failed: ${error.message}`,
        orderIds,
      });
      logger.error(`failed to unlock ${orderIds.length} order(s): ${e}`);
      logger.error(`failed batch contained: ${orderIds.join(',')}`);
      logger.error(e);
    }

    return unlockedOrders;
  }

  private async sendBatchUnlock(
    giveChain: ExecutorSupportedChain,
    orderIds: string[],
    logger: Logger,
  ): Promise<string> {
    const [giveNativePrice, takeNativePrice] = await Promise.all([
      this.executor.tokenPriceService.getPrice(giveChain.chain, null, {
        logger: createClientLogger(logger),
      }),
      this.executor.tokenPriceService.getPrice(this.takeChain.chain, null, {
        logger: createClientLogger(logger),
      }),
    ]);

    const fees = await this.executor.client.getClaimExecutionFee(
      {
        action: 'ClaimBatchUnlock',
        giveChain: giveChain.chain,
        giveNativePrice,
        takeChain: this.takeChain.chain,
        takeNativePrice,
        batchSize: orderIds.length,
        loggerInstance: createClientLogger(logger),
      },
      {
        orderEstimationStage: OrderEstimationStage.OrderFulfillment,
      },
    );

    const batchUnlockTx = await this.executor.client.sendBatchUnlock(
      {
        beneficiary: giveChain.beneficiary,
        executionFee: fees.total,
        loggerInstance: createClientLogger(logger),
        orders: orderIds.map((orderId) => ({
          ...this.ordersDataMap.get(orderId)!,
          orderId: helpers.hexToBuffer(orderId),
        })),
      },
      {
        solanaInitWalletReward: fees.rewards[0],
        solanaClaimUnlockReward: fees.rewards[1],
        unlocker: this.takeChain.unlockProvider.bytesAddress,
      },
    );

    return this.takeChain.unlockProvider.sendTransaction(batchUnlockTx, {
      logger,
    });
  }

  #getMaxBatchUnlockSize(giveChainId: ChainId): number {
    if (giveChainId === ChainId.Solana) return this.#BATCH_UNLOCK_TO_SOLANA_MAX_SIZE;
    return this.#BATCH_UNLOCK_TO_MAX_SIZE;
  }

  #getBatchUnlockSize(giveChainId: ChainId): number {
    // batch_unlock EVM -> Solana: accept up to 7 orders coming from Solana
    return Math.min(this.#getMaxBatchUnlockSize(giveChainId), this.batchUnlockSize);
  }
}
