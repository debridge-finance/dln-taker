import {ChainId, PMMClient} from "@debridge-finance/pmm-client";
import { OrderData } from "@debridge-finance/pmm-client/src/order";
import { Logger } from "pino";

import { ExecutorConfig } from "../config";
import { ProviderAdapter } from "../providers/provider.adapter";

export interface ValidatorContext {
  logger: Logger;
  client: PMMClient;
  providers: Map<ChainId, ProviderAdapter>;
}

/**
 * Represents an order validation routine. Can be chained.
 * Returns true if order can be processed, false otherwise.
 *
 */
export type OrderValidator = (
  order: OrderData,
  config: ExecutorConfig,
  context: ValidatorContext
) => Promise<boolean>;
