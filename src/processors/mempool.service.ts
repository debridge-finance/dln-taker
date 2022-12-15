import { OrderData } from "@debridge-finance/dln-client";
import { Logger } from "pino";

import { OrderProcessor, OrderProcessorContext } from "./order.processor";

type ProcessorParams = {
  params: {
    order: OrderData;
    orderId: string;
    context: OrderProcessorContext;
  };
  orderProcessor: OrderProcessor;
};

export class MempoolService {
  private readonly logger: Logger;
  private readonly orderParams: Map<string, ProcessorParams> = new Map();
  private isLocked: boolean = false; // for lock process while current processing is working
  constructor(logger: Logger) {
    this.logger = logger.child({ service: "MempoolService" });
  }

  addOrder(params: ProcessorParams) {
    const orderId = params.params.orderId;
    this.orderParams.set(orderId, params);
    this.logger.info(`Order ${orderId} is added to mempool`);
  }

  async process() {
    if (this.isLocked) {
      this.logger.info("MempoolService is working");
      return;
    }
    this.isLocked = true;
    const startProcessingTime = new Date().getTime();
    const ordersCountBeforeProcessing = this.orderParams.size;
    this.logger.info(
      `Mempool contains ${ordersCountBeforeProcessing} before processing`
    );
    for (const orderId of this.orderParams.keys()) {
      try {
        const { orderProcessor, params } = this.orderParams.get(orderId)!;
        const result = await orderProcessor.process(
          orderId,
          params.order,
          params.context
        );
        if (result) {
          this.removeOrder(orderId);
        }
      } catch (e) {
        this.logger.error(`Error in processing ${orderId}: ${e}`);
      }
    }
    const ordersCountAfterProcessing = this.orderParams.size;
    const endProcessingTime = new Date().getTime();
    const executionTime = endProcessingTime - startProcessingTime;
    this.logger.info(
      `Mempool contains ${ordersCountAfterProcessing} before processing`
    );
    this.logger.info(
      `Mempool stats:  ordersCountAfterProcessing: ${ordersCountAfterProcessing}, ordersCountBeforeProcessing: ${ordersCountBeforeProcessing}, executionTime: ${executionTime} ms`
    );

    this.isLocked = false;
  }

  private removeOrder(orderId: string) {
    this.orderParams.delete(orderId);
    this.logger.info(`Order ${orderId} is deleted from mempool`);
  }
}
