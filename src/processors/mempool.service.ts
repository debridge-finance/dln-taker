import { Logger } from "pino";

import { ProcessOrder, ProcessorParams } from "../interfaces";

export class MempoolService {
  private readonly logger: Logger;
  private readonly orderParams: ProcessorParams[] = [];
  private isLocked: boolean = false; // for lock process while current processing is working
  constructor(
    logger: Logger,
    private readonly processOrderFunction: ProcessOrder,
    mempoolIntervalMs: number
  ) {
    this.logger = logger.child({ service: "MempoolService" });
    setInterval(() => {
      this.process();
    }, mempoolIntervalMs);
  }

  addOrder(params: ProcessorParams) {
    const orderId = params.orderInfo.orderId;
    this.orderParams.push(params);
    this.logger.info(`Order ${orderId} is added to mempool`);
  }

  async process() {
    if (this.isLocked) {
      this.logger.info("MempoolService is working");
      return;
    }
    this.isLocked = true;
    const ordersCountBeforeProcessing = this.orderParams.length;
    this.logger.info(
      `Mempool contains ${ordersCountBeforeProcessing} before processing`
    );
    let param = this.orderParams.shift();
    while (param) {
      this.processOrderFunction(param);
      param = this.orderParams.shift();
    }

    this.isLocked = false;
  }
}
