import { Logger } from "pino";

import { IncomingOrderContext, ProcessOrder } from "../interfaces";

export class MempoolService {
  private readonly logger: Logger;
  private readonly orderParams = new Map<string, IncomingOrderContext>();
  private isLocked: boolean = false; // for lock process while current processing is working
  constructor(
    logger: Logger,
    private readonly processOrderFunction: ProcessOrder,
    mempoolInterval: number
  ) {
    this.logger = logger.child({ service: "MempoolService" });
    setInterval(() => {
      this.process();
    }, mempoolInterval * 1000);
  }

  addOrder(params: IncomingOrderContext) {
    const orderId = params.orderInfo.orderId;
    this.orderParams.set(orderId, params);

    // logging from the order's context
    params.context.logger.debug("added to mempool")

    // logging from the service's context
    this.logger.debug(`current mempool size: ${this.orderParams.size} order(s)`);
  }

  async process() {
    if (this.isLocked) {
      this.logger.debug("MempoolService is already working");
      return;
    }
    this.isLocked = true;
    const ordersCountBeforeProcessing = this.orderParams.size;
    this.logger.info(
      `sending ${ordersCountBeforeProcessing} orders to the processing`
    );
    this.orderParams.forEach((value) => {
      this.processOrderFunction(value);
    });
    this.orderParams.clear();

    this.isLocked = false;
  }

  delete(orderId: string) {
    this.orderParams.delete(orderId);
  }
}
