import { ChainId, OrderData } from "@debridge-finance/dln-client";
import { Logger } from "pino";

import {
  ExecutorConf,
  InitializingChain,
  SupportedChainConfig,
} from "../executors/executor";

export interface FilterContext {
  logger: Logger;
  config: ExecutorConf;
  giveChain: SupportedChainConfig;
  takeChain: SupportedChainConfig;
}

export type OrderFilterInitContext = {
  logger: Logger;
  chain: InitializingChain;
};

export type OrderFilterInitializer = (
  chainId: ChainId,
  context: OrderFilterInitContext
) => Promise<OrderFilter>;

/**
 * Represents an order filter routine. Can be chained.
 * Returns true if order can be processed, false otherwise.
 *
 */
export type OrderFilter = (
  order: OrderData,
  context: FilterContext
) => Promise<boolean>;
