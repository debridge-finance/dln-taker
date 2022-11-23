import { ChainId, PMMClient } from "@debridge-finance/pmm-client";
import { OrderData } from "@debridge-finance/pmm-client";
import { Logger } from "pino";

import { ExecutorConfig } from "../config";
import { ProviderAdapter } from "../providers/provider.adapter";

export class OrderProcessorContext {
  client: PMMClient;
  orderFulfilledMap: Map<string, boolean>;
  logger: Logger;
  providersForUnlock: Map<ChainId, ProviderAdapter>;
  providersForFulfill: Map<ChainId, ProviderAdapter>;
}

/**
 * Represents an order fulfillment engine. Cannot be chained, but can be nested.
 *
 */
export type OrderProcessor = (
  orderId: string,
  order: OrderData,
  executorConfig: ExecutorConfig,
  context: OrderProcessorContext
) => Promise<void>;
