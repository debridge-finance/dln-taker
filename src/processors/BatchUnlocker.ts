import {
  buffersAreEqual,
  ChainId,
  OrderData,
  OrderState,
  tokenAddressToString,
} from '@debridge-finance/dln-client';
import { Logger } from 'pino';

import { helpers } from '@debridge-finance/solana-utils';
import {
  ExecutorSupportedChain,
  IExecutor,
} from '../executor';

import { OrderProcessorContext } from './base';
import { TransactionBuilder } from 'src/chain-common/tx-builder';

export class BatchUnlocker {
  private ordersDataMap = new Map<string, OrderData>(); // orderId => orderData

  private unlockBatchesOrderIdMap = new Map<ChainId, Set<string>>(); // chainId => orderId[]

  private isBatchUnlockLocked: boolean = false;

  private readonly logger: Logger;

  constructor(
    logger: Logger,
    private readonly executor: IExecutor,
    private readonly takeChain: ExecutorSupportedChain,
    private readonly transactionBuilder: TransactionBuilder
  ) {
    this.logger = logger.child({
      service: 'batchUnlock',
      takeChainId: this.takeChain.chain,
    });
  }

  async unlockOrder(
    orderId: string,
    order: OrderData,
    context: OrderProcessorContext,
  ): Promise<void> {
    // validate current order state:
    const orderState = await this.executor.client.getTakeOrderState(
      {
        orderId,
        takeChain: this.takeChain.chain,
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

    const unlockAuthority = this.takeChain.unlockProvider.bytesAddress;
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

    this.tryUnlock(order.give.chainId);
  }

  async tryUnlock(giveChainId: ChainId): Promise<void> {
    // check that process is blocked
    if (this.isBatchUnlockLocked) {
      this.logger.debug('batch unlock processing is locked, not performing unlock procedures');
      return;
    }

    const currentSize = this.unlockBatchesOrderIdMap.get(giveChainId)!.size;
    if (currentSize < this.getBatchUnlockSize(giveChainId)) {
      this.logger.debug('batch is not fulled yet, not performing unlock procedures');
      return;
    }

    this.isBatchUnlockLocked = true;
    this.logger.debug(`trying to send batch unlock to ${ChainId[giveChainId]}`);
    const batchSucceeded = await this.performBatchUnlock(giveChainId);
    if (batchSucceeded) {
      this.logger.debug(
        `succeeded sending batch to ${ChainId[giveChainId]}, checking other directions`,
      );
      await this.unlockAny();
    } else {
      this.logger.error('batch unlock failed, stopping unlock procedures');
    }
    this.isBatchUnlockLocked = false;
  }

  private async unlockAny(): Promise<void> {
    let giveChainId = this.peekNextBatch();
    while (giveChainId) {
      this.logger.debug(`trying to send batch unlock to ${ChainId[giveChainId]}`);
      // eslint-disable-next-line no-await-in-loop -- Intentional because we want to handle all available batches
      const batchSucceeded = await this.performBatchUnlock(giveChainId);
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
      if (orderIds.size >= this.getBatchUnlockSize(chainId)) {
        return chainId;
      }
    }

    return undefined;
  }

  private getBatchUnlockSize(giveChainId: ChainId): number {
    return this.executor.getSupportedChain(giveChainId).srcConstraints.unlockBatchSize
  }

  /**
   * returns true if batch unlock succeeded (e.g. all orders were successfully unlocked)
   */
  private async performBatchUnlock(giveChainId: ChainId): Promise<boolean> {
    const orderIds = Array.from(this.unlockBatchesOrderIdMap.get(giveChainId)!).slice(
      0,
      this.getBatchUnlockSize(giveChainId),
    );

    const unlockedOrders = await this.unlockOrders(giveChainId, orderIds);

    // clean executed orders form queue
    unlockedOrders.forEach((id) => {
      this.unlockBatchesOrderIdMap.get(giveChainId)!.delete(id);
      this.ordersDataMap.delete(id);
    });

    return unlockedOrders.length === this.getBatchUnlockSize(giveChainId);
  }

  private async unlockOrders(giveChainId: ChainId, orderIds: string[]): Promise<string[]> {
    const unlockedOrders: string[] = [];
    const logger = this.logger.child({
      giveChainId,
      orderIds,
    });

    logger.info(`picked ${orderIds.length} orders to unlock`);
    logger.debug(orderIds.join(','));

    // get current state of the orders, to catch those that are already fulfilled
    const notUnlockedOrders: boolean[] = await Promise.all(
      orderIds.map(async (orderId) => {
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
    // filter off orders that are already unlocked
    // eslint-disable-next-line no-param-reassign -- Must be rewritten ASAP, TODO: #862kaqf9u
    orderIds = orderIds.filter((_, idx) => {
      if (notUnlockedOrders[idx]) return true;
      unlockedOrders.push(orderIds[idx]);
      return false;
    });
    logger.debug(`pre-filtering: ${unlockedOrders.length} already unlocked`);

    const giveChain = this.executor.chains[giveChainId];
    if (!giveChain) throw new Error(`Give chain not set: ${ChainId[giveChainId]}`);

    try {
      const sendBatchUnlockTransactionHash = await this.sendBatchUnlock(
        orderIds,
        logger,
      );
      unlockedOrders.push(...orderIds);

      logger.info(
        `send_unlock tx (hash: ${sendBatchUnlockTransactionHash}) with ${
          orderIds.length
        } orders: ${orderIds.join(', ')}`,
      );

      this.executor.hookEngine.handleOrderUnlockSent({
        fromChainId: this.takeChain.chain,
        toChainId: giveChain.chain,
        txHash: sendBatchUnlockTransactionHash,
        orderIds,
      });
    } catch (e) {
      const error = e as Error;
      this.executor.hookEngine.handleOrderUnlockFailed({
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
    orderIds: string[],
    logger: Logger,
  ): Promise<string> {
    return this.transactionBuilder.getBatchOrderUnlockTxSender(
      orderIds.map((orderId) => ({
        ...this.ordersDataMap.get(orderId)!,
        orderId: helpers.hexToBuffer(orderId),
      })), logger
    )();
  }
}
