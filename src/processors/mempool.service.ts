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
    this.logger.info(`Order ${orderId} is added to mempool`);
  }

  async process() {
    if (this.isLocked) {
      this.logger.info("MempoolService is working");
      return;
    }
    this.isLocked = true;
    const ordersCountBeforeProcessing = this.orderParams.size;
    this.logger.info(
      `Mempool contains ${ordersCountBeforeProcessing} before processing`
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
