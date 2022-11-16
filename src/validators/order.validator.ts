import {OrderData} from "@debridge-finance/pmm-client/src/order";
import {PMMClient} from "@debridge-finance/pmm-client";
import {ExecutorConfig} from "../config";
import {Logger} from "pino";

export interface ValidatorContext {
  logger: Logger;
  client: PMMClient;
}

/**
 * Represents an order validation routine. Can be chained.
 * Returns true if order can be processed, false otherwise.
 *
 */
export type OrderValidator = (order: OrderData, config: ExecutorConfig, context: ValidatorContext) => Promise<boolean>;
