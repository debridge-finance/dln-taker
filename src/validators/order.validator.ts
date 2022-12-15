import { ChainId, OrderData, PMMClient } from "@debridge-finance/dln-client";

import { Logger } from "pino";

import { ExecutorLaunchConfig } from "../config";
import { ExecutorConf, InitializingChain, SupportedChainConfig } from "../executor";
import { ProviderAdapter } from "../providers/provider.adapter";

export interface ValidatorContext {
  logger: Logger;
  config: ExecutorConf;
  giveChain: SupportedChainConfig;
  takeChain: SupportedChainConfig;
}

export type OrderValidatorInitContext = {
  logger: Logger,
  chain: InitializingChain
}

export type OrderValidatorInitializer = (chainId: ChainId, context: OrderValidatorInitContext) => Promise<OrderValidator>

/**
 * Represents an order validation routine. Can be chained.
 * Returns true if order can be processed, false otherwise.
 *
 */
export type OrderValidator = (
  order: OrderData,
  context: ValidatorContext
) => Promise<boolean>;
