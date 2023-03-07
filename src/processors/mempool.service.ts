import { Logger } from "pino";

import { IncomingOrderContext, ProcessOrder } from "../interfaces";
import { setTimeout } from 'timers/promises'

export class MempoolService {
  private readonly logger: Logger;
  private readonly orderParams = new Map<string, IncomingOrderContext>();
  constructor(
    logger: Logger,
    private readonly processOrderFunction: ProcessOrder,
    private readonly maxReprocessDelay: number,
    private readonly delayStep: number = 30
  ) {
    this.logger = logger.child({ service: "MempoolService" });
  }

  private getDelayPromise(delay: number) {
    return setTimeout(delay * 1000)
  }

  /**
   * Adds an order to the mempool. An order would be invoked when either a default delay is triggered
   * or the given trigger (as Promise) or delay (in seconds)
   * @param params
   * @param triggerOrDelay
   */
  addOrder(params: IncomingOrderContext, triggerOrDelay?: Promise<any> | number) {
    const orderId = params.orderInfo.orderId;
    this.orderParams.set(orderId, params);

    // logging from the order's context
    params.context.logger.debug("added to mempool");

    // logging from the service's context
    this.logger.debug(
      `current mempool size: ${this.orderParams.size} order(s)`
    );

    const promiseStartTime = new Date()
    const maxTimeoutPromise = this.getDelayPromise(this.maxReprocessDelay + (this.delayStep * params.attempts))
    if (triggerOrDelay && typeof triggerOrDelay === 'number')
      triggerOrDelay = this.getDelayPromise(triggerOrDelay);

    const trigger = triggerOrDelay
      ? Promise.any([triggerOrDelay, maxTimeoutPromise])
      : maxTimeoutPromise;

    trigger
      .catch((reason) => {
        params.context.logger.error(`mempool promise triggered error: ${reason}`)
        params.context.logger.error(reason);
      })
      .finally(() => {
        const settlementTime = new Date();
        const waitingTime = (settlementTime.getTime() - promiseStartTime.getTime()) / 1000;
        params.context.logger.debug(`mempool promise triggered after ${waitingTime}s`)
        if (this.orderParams.has(orderId)) {
          params.context.logger.debug(`invoking order processing routine`)
          this.orderParams.delete(orderId);
          params.attempts++;
          this.processOrderFunction(params);
        }
        else {
          params.context.logger.debug(`order does not exist in the mempool`)
        }
      })
  }

  delete(orderId: string) {
    this.orderParams.delete(orderId);
  }
}
