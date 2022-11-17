import { PMMClient } from "@debridge-finance/pmm-client";
import { OrderData } from "@debridge-finance/pmm-client/src/order";
import { Logger } from "pino";

import { ChainConfig, ExecutorConfig } from "../config";

export class OrderProcessorContext {
  client: PMMClient;
  orderFulfilledMap: Map<string, boolean>;
  logger: Logger;
}

/**
 * Represents an order fulfillment engine. Cannot be chained, but can be nested.
 *
 */
export type OrderProcessor = (
  orderId: string,
  order: OrderData,
  executorConfig: ExecutorConfig,
  chainConfig: ChainConfig,
  context: OrderProcessorContext
) => Promise<void>;
