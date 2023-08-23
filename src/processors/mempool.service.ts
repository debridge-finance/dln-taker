import { Logger } from "pino";

import { setTimeout } from 'timers/promises'
import { ProcessOrder } from "../interfaces";
import { OrderId } from "./base";

export class MempoolService {
  readonly #logger: Logger;

  readonly #trackedOrders = new Set<OrderId>();

  constructor(
    logger: Logger,
    private readonly processOrderFunction: ProcessOrder,
    private readonly maxReprocessDelay: number,
    private readonly delayStep: number = 30
  ) {
    this.#logger = logger.child({ service: "MempoolService" });
  }

  private static getDelayPromise(delay: number) {
    return setTimeout(delay * 1000)
  }

  /**
   * Adds an order to the mempool. An order would be invoked when either a default delay is triggered
   * or the given trigger (as Promise) or delay (in seconds)
   * @param params
   * @param triggerOrDelay
   */
  addOrder(orderId: OrderId, delay?: number, attempt: number = 0) {
    const orderLogger = this.#logger.child({ orderId });

    if (this.#trackedOrders.has(orderId)) {
      orderLogger.debug("already present in the mempool, not adding again");
      return;
    }

    this.#trackedOrders.add(orderId);
    orderLogger.debug(`added to mempool, new mempool size: ${this.#trackedOrders.size} order(s)`);

    const promiseStartTime = new Date()
    const maxTimeoutPromise = MempoolService.getDelayPromise(this.maxReprocessDelay + (this.delayStep * attempt))
    const trigger = delay
      ? Promise.any([MempoolService.getDelayPromise(delay), maxTimeoutPromise])
      : maxTimeoutPromise;

    trigger
      .catch((reason) => {
        orderLogger.error(`mempool promise triggered error: ${reason}`)
        orderLogger.error(reason);
      })
      .finally(() => {
        const settlementTime = new Date();
        const waitingTime = (settlementTime.getTime() - promiseStartTime.getTime()) / 1000;
        orderLogger.debug(`mempool promise triggered after ${waitingTime}s`)
        if (this.#trackedOrders.has(orderId)) {
          orderLogger.debug(`invoking order processing routine`)
          this.#trackedOrders.delete(orderId);
          this.processOrderFunction(orderId);
        }
        else {
          orderLogger.debug(`order does not exist in the mempool`)
        }
      })
  }

  delete(orderId: string) {
    this.#trackedOrders.delete(orderId);
    this.#logger.child({orderId})
      .debug("order has been removed from the mempool")
  }
}
