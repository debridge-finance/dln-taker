import {OrderData} from "@debridge-finance/pmm-client/src/order";
import {ChainConfig, ExecutorConfig,} from "../config";
import {PMMClient} from "@debridge-finance/pmm-client";
import {Logger} from "pino";

export class OrderProcessorContext {
  client: PMMClient;
  orderFulfilledMap: Map<string, boolean>;
  logger: Logger;
}

/**
 * Represents an order fulfillment engine. Cannot be chained, but can be nested.
 *
 */
export type OrderProcessor = (orderId: string, order: OrderData, executorConfig: ExecutorConfig, fulfillableChainConfig: ChainConfig, context: OrderProcessorContext) => Promise<void>;
