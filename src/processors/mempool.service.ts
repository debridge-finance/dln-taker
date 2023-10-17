import { Logger } from 'pino';
import { OrderId } from 'src/interfaces';

export type OrderConsumer = (orderId: OrderId) => void;

export type MempoolOpts = {
  baseDelay: number;
  baseArchivalDelay: number;
  delayStep: number;
  archivalDelayStep: number;
};

const defaultOpts: MempoolOpts = {
  baseDelay: 5,
  baseArchivalDelay: 60 * 2,
  delayStep: 10,
  archivalDelayStep: 60 * 5,
};

export class MempoolService {
  readonly #logger: Logger;

  readonly #opts: MempoolOpts;

  readonly #trackedOrders = new Map<OrderId, ReturnType<typeof setTimeout>>();

  constructor(
    logger: Logger,
    private readonly orderConsumer: OrderConsumer,
  ) {
    this.#logger = logger.child({ service: MempoolService.name });
    this.#opts = defaultOpts;
  }

  delayArchivalOrder(orderId: OrderId, attempt: number) {
    this.addOrder(
      orderId,
      this.#opts.baseArchivalDelay + this.#opts.archivalDelayStep * (attempt - 1),
    );
  }

  delayOrder(orderId: OrderId, attempt: number) {
    this.addOrder(orderId, this.#opts.baseDelay + this.#opts.delayStep * (attempt - 1));
  }

  /**
   * Adds an order to the mempool. An order would be invoked when either a default delay is triggered
   * or the given trigger (as Promise) or delay (in seconds)
   * @param params
   * @param triggerOrDelay
   */
  addOrder(orderId: OrderId, delay: number = 0) {
    const orderLogger = this.#logger.child({ orderId });

    if (this.#trackedOrders.has(orderId)) {
      clearTimeout(this.#trackedOrders.get(orderId));
    }

    const timeoutId = setTimeout(this.getTimeoutFunc(orderId, orderLogger), delay * 1000);
    this.#trackedOrders.set(orderId, timeoutId);

    orderLogger.debug(
      `added to mempool (delay: ${delay}s), new mempool size: ${this.#trackedOrders.size} order(s)`,
    );
  }

  delete(orderId: string) {
    if (this.#trackedOrders.has(orderId)) {
      clearTimeout(this.#trackedOrders.get(orderId));
    }
    this.#trackedOrders.delete(orderId);
    this.#logger.child({ orderId }).debug('order has been removed from the mempool');
  }

  private getTimeoutFunc(orderId: OrderId, logger: Logger) {
    const promiseStartTime = new Date();
    return () => {
      const settlementTime = new Date();
      const waitingTime = (settlementTime.getTime() - promiseStartTime.getTime()) / 1000;
      logger.debug(`mempool promise triggered after ${waitingTime}s`);
      if (this.#trackedOrders.has(orderId)) {
        logger.debug(`invoking order processing routine`);
        this.#trackedOrders.delete(orderId);
        this.orderConsumer(orderId);
      } else {
        logger.debug(`order does not exist in the mempool`);
      }
    };
  }
}
