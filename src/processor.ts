import { Logger } from 'pino';
import { ChainId, OrderData } from '@debridge-finance/dln-client';
import { IncomingOrder, IncomingOrderContext, OrderId, OrderInfoStatus } from './interfaces';
import { BatchUnlocker } from './processors/BatchUnlocker';
import { MempoolService } from './processors/mempool.service';
import { PostponingReason, RejectionReason } from './hooks/HookEnums';
import { IExecutor, ExecutorSupportedChain } from './executor';
import { assert, die } from './errors';
import { CreatedOrder } from './chain-common/order';
import { TakerShortCircuit } from './chain-common/order-taker';
import { TransactionBuilder, TransactionSender } from './chain-common/tx-builder';

export interface InitTransactionBuilder {
  getInitTxSenders(logger: Logger): Promise<Array<TransactionSender>>;
}

// Represents all necessary information about Created order during its internal lifecycle
type CreatedOrderMetadata = {
  readonly orderId: OrderId;
  readonly arrivedAt: Date;
  attempts: number;
  context: IncomingOrderContext;
};

enum BreakReason {
  ShouldPostpone,
  ShouldReject,
}

type ProcessorCircuitBreaker<T extends BreakReason> = {
  circuitBreaker: true;
  breakReason: T;
} & (T extends BreakReason.ShouldReject ? { rejection: RejectionReason; message: string } : {}) &
  (T extends BreakReason.ShouldPostpone
    ? { postpone: PostponingReason; message: string; delay?: number }
    : {});

function getShortCircuit(): TakerShortCircuit {
  return {
    reject: (rejection: RejectionReason, message: string) => {
      const error: ProcessorCircuitBreaker<BreakReason.ShouldReject> = {
        circuitBreaker: true,
        breakReason: BreakReason.ShouldReject,
        rejection,
        message,
      };
      return Promise.reject(error);
    },

    postpone: (postpone: PostponingReason, message: string, delay?: number) => {
      const error: ProcessorCircuitBreaker<BreakReason.ShouldPostpone> = {
        circuitBreaker: true,
        breakReason: BreakReason.ShouldPostpone,
        postpone,
        message,
        delay,
      };
      return Promise.reject(error);
    },
  };
}

export class OrderProcessor {
  readonly #mempoolService: MempoolService;

  readonly #batchUnlocker: BatchUnlocker;

  readonly #logger: Logger;

  private priorityQueue = new Set<OrderId>(); // queue of orderid for processing created order

  private queue = new Set<OrderId>(); // queue of orderid for retry processing order

  private eventsQueue = new Array<IncomingOrderContext>();

  private isLocked: boolean = false;

  readonly #createdOrdersMetadata = new Map<OrderId, CreatedOrderMetadata>();

  private constructor(
    private readonly transactionBuilder: TransactionBuilder,
    private readonly takeChain: ExecutorSupportedChain,
    private readonly executor: IExecutor,
    logger: Logger,
  ) {
    this.#logger = logger.child({
      service: OrderProcessor.name,
      takeChainId: takeChain.chain,
      takeChainName: ChainId[takeChain.chain],
    });

    this.#batchUnlocker = new BatchUnlocker(
      this.#logger,
      executor,
      this.takeChain,
      transactionBuilder,
    );

    this.#mempoolService = new MempoolService(this.#logger, (orderId: string) =>
      this.handleOrder(orderId),
    );
  }

  public static async initialize(
    transactionBuilder: TransactionBuilder,
    takeChain: ExecutorSupportedChain,
    executor: IExecutor,
    logger: Logger,
  ): Promise<OrderProcessor> {
    const me = new OrderProcessor(transactionBuilder, takeChain, executor, logger);
    return me.init();
  }

  private async init(): Promise<OrderProcessor> {
    for (const txSender of await this.transactionBuilder.getInitTxSenders(this.#logger)) {
      // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
      const txHash = await txSender();
      this.#logger.info(`Initialization txn sent: ${txHash}`);
    }
    return this;
  }

  private handleOrder(orderId: string): void {
    this.process(this.getCreatedOrderMetadata(orderId).context);
  }

  handleEvent(context: IncomingOrderContext): void {
    const { status, orderId } = context.orderInfo;

    // creation events must be tracked in a separate storage
    if ([OrderInfoStatus.Created, OrderInfoStatus.ArchivalCreated].includes(status)) {
      if (this.#createdOrdersMetadata.has(orderId)) {
        this.#createdOrdersMetadata.get(orderId)!.context = context;
      } else {
        this.#createdOrdersMetadata.set(orderId, {
          orderId,
          arrivedAt: new Date(),
          attempts: 0,
          context,
        });
      }
    }

    this.process(context);
  }

  private clearInternalQueues(orderId: string): void {
    this.queue.delete(orderId);
    this.priorityQueue.delete(orderId);
    this.#mempoolService.delete(orderId);
  }

  private clearOrderStore(orderId: string): void {
    this.#createdOrdersMetadata.delete(orderId);
  }

  private async process(context: IncomingOrderContext): Promise<void> {
    const { status, orderId } = context.orderInfo;

    // already processing an order
    if (this.isLocked) {
      this.#logger.debug(`processor is busy, postponing order ${orderId}`);

      switch (status) {
        case OrderInfoStatus.ArchivalCreated: {
          this.queue.add(orderId);
          this.#logger.debug(`order ${orderId} postponed to secondary queue`);
          break;
        }
        case OrderInfoStatus.Created: {
          this.priorityQueue.add(orderId);
          this.#logger.debug(`order ${orderId} postponed to primary queue`);
          break;
        }
        default: {
          this.#logger.debug(`order ${orderId} postponed to event queue`);
          this.eventsQueue.push(context);
        }
      }

      return;
    }

    this.isLocked = true;
    this.#logger.info(`⛏️ processing order ${orderId}, status: ${OrderInfoStatus[status]}`);

    switch (status) {
      case OrderInfoStatus.Created:
      case OrderInfoStatus.ArchivalCreated: {
        const metadata = this.getCreatedOrderMetadata(context.orderInfo.orderId);
        metadata.attempts++;
        await this.takeOrder(metadata);

        break;
      }
      case OrderInfoStatus.ArchivalFulfilled: {
        this.#batchUnlocker.unlockOrder(orderId, context.orderInfo.order);

        break;
      }
      case OrderInfoStatus.Cancelled: {
        this.clearInternalQueues(orderId);
        this.clearOrderStore(orderId);

        break;
      }
      case OrderInfoStatus.Fulfilled: {
        this.clearInternalQueues(orderId);
        this.clearOrderStore(orderId);
        context.giveChain.TVLBudgetController.flushCache();
        context.takeChain.TVLBudgetController.flushCache();
        this.#batchUnlocker.unlockOrder(orderId, context.orderInfo.order);

        break;
      }
      default: {
        this.#logger.debug(`status=${OrderInfoStatus[status]} not implemented, skipping`);
      }
    }
    this.#logger.debug(`finished processing order ${orderId}, status: ${OrderInfoStatus[status]}`);
    this.isLocked = false;

    if (this.eventsQueue.length > 0) {
      this.#logger.debug(`has events (${this.eventsQueue.length} in the events queue, picking`);
      this.handleEvent(this.eventsQueue.shift()!);
      return;
    }

    const nextOrderId = this.pickNextOrderId();
    if (nextOrderId) {
      this.#logger.debug(`has orders in the orders queue, picking ${nextOrderId}`);
      this.handleOrder(nextOrderId);
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

  private getCreatedOrderMetadata(orderId: OrderId): CreatedOrderMetadata {
    assert(
      this.#createdOrdersMetadata.has(orderId),
      `Unexpected: missing created order data (orderId: ${orderId})`,
    );
    return this.#createdOrdersMetadata.get(orderId)!;
  }

  private postponeOrder(
    orderId: OrderId,
    order: OrderData,
    isLive: boolean,
    attempt: number,
    message: string,
    reason: PostponingReason,
    remainingDelay?: number,
  ) {
    this.#logger.info(
      `⏸ postponed order ${orderId} because of ${PostponingReason[reason]}: ${message}`,
    );

    this.executor.hookEngine.handleOrderPostponed({
      orderId,
      order,
      message,
      reason,
      isLive,
      executor: this.executor,
      attempts: attempt,
    });

    if (remainingDelay) {
      this.#mempoolService.addOrder(orderId, remainingDelay);
    } else if (!isLive) {
      this.#mempoolService.delayArchivalOrder(orderId, attempt);
    } else {
      this.#mempoolService.delayOrder(orderId, attempt);
    }
  }

  private rejectOrder(
    orderId: OrderId,
    order: OrderData,
    isLive: boolean,
    attempt: number,
    message: string,
    reason: RejectionReason,
  ): Promise<void> {
    this.#logger.info(
      `𐄂 rejected order ${orderId} because of ${RejectionReason[reason]}: ${message}`,
    );

    this.executor.hookEngine.handleOrderRejected({
      orderId,
      order,
      isLive,
      executor: this.executor,
      message,
      reason,
      attempts: attempt,
    });

    return Promise.resolve();
  }

  private static getFinalizationInfo(
    status: OrderInfoStatus,
    finalizationInfo: IncomingOrder<OrderInfoStatus.Created>['finalization_info'],
  ): 'Revoked' | 'Finalized' | number {
    if (status === OrderInfoStatus.ArchivalCreated) return 'Finalized';
    if (finalizationInfo === 'Revoked') return 'Revoked';
    if ('Finalized' in finalizationInfo) return 'Finalized';
    if ('Confirmed' in finalizationInfo)
      return Number(finalizationInfo.Confirmed.confirmation_blocks_count);
    return 0;
  }

  private async takeOrder(metadata: CreatedOrderMetadata): Promise<void> {
    const { orderInfo } = metadata.context;

    // special case for revokes: WS sends revokes as a part of Created event, and we want to handle it ASAP
    // probably, we need to move this special case to a higher level event handler (handleEvent) and convert it into ordinary event
    const finalizationInfo = OrderProcessor.getFinalizationInfo(
      orderInfo.status,
      (orderInfo as IncomingOrder<OrderInfoStatus.Created>).finalization_info,
    );
    const isLive = metadata.context.orderInfo.status === OrderInfoStatus.Created;
    if (finalizationInfo === 'Revoked') {
      this.clearInternalQueues(orderInfo.orderId);

      const message = 'order has been revoked by the order feed due to chain reorganization';
      return this.rejectOrder(
        orderInfo.orderId,
        orderInfo.order,
        isLive,
        metadata.attempts,
        message,
        RejectionReason.REVOKED,
      );
    }

    const order = new CreatedOrder(
      orderInfo.orderId,
      orderInfo.order,
      finalizationInfo,
      metadata.arrivedAt,
      metadata.attempts,
      {
        executor: this.executor,
        giveChain: metadata.context.giveChain,
        takeChain: metadata.context.takeChain,
        logger: this.#logger,
      },
    );

    try {
      await order.getTaker().take(getShortCircuit(), this.transactionBuilder);
      this.markOrderAsFulfilled(order);
    } catch (e) {
      if ((<ProcessorCircuitBreaker<any>>e).circuitBreaker === true) {
        const circuitBreaker = <ProcessorCircuitBreaker<any>>e;

        switch ((<ProcessorCircuitBreaker<any>>e).breakReason) {
          case BreakReason.ShouldReject: {
            const v = <ProcessorCircuitBreaker<BreakReason.ShouldReject>>circuitBreaker;
            return this.rejectOrder(
              orderInfo.orderId,
              orderInfo.order,
              isLive,
              metadata.attempts,
              v.message,
              v.rejection,
            );
          }
          case BreakReason.ShouldPostpone: {
            const v = <ProcessorCircuitBreaker<BreakReason.ShouldPostpone>>circuitBreaker;
            return this.postponeOrder(
              orderInfo.orderId,
              orderInfo.order,
              isLive,
              metadata.attempts,
              v.message,
              v.postpone,
              v.delay,
            );
          }
          default: {
            die(`Unexpected verification result: ${circuitBreaker.breakReason}`);
          }
        }
      }

      this.#logger.error(
        `⚠️ processing order ${order.orderId} failed with an unhandled error: ${e}`,
      );
      this.#logger.error(e);
      return this.postponeOrder(
        orderInfo.orderId,
        orderInfo.order,
        isLive,
        metadata.attempts,
        `${e}`,
        PostponingReason.UNHANDLED_ERROR,
      );
    }

    return Promise.resolve();
  }

  private markOrderAsFulfilled(order: CreatedOrder) {
    this.#logger.info(`✔ order ${order.orderId} has been attempted to be fulfilled`);
    // order is fulfilled, remove it from queues (the order may have come again thru WS)
    this.clearInternalQueues(order.orderId);

    // putting the order to the mempool, in case fulfill_txn gets lost
    const fulfillCheckDelay: number =
      this.takeChain.network.avgBlockSpeed * this.takeChain.network.finalizedBlockCount;
    this.#mempoolService.addOrder(order.orderId, fulfillCheckDelay);
  }
}
