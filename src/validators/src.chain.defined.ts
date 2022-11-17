import { PMMClient } from "@debridge-finance/pmm-client";
import { OrderData } from "@debridge-finance/pmm-client/src/order";

import { ExecutorConfig } from "../config";

import { OrderValidator, ValidatorContext } from "./order.validator";

/**
 * Checks if the source chain for the given order is defined in the config.
 * This validator is made for convenience because it won't be possible to fulfill an order if its source chain is not defined in the configuration file.
 */
export const srcChainDefined = (): OrderValidator => {
  return (
    order: OrderData,
    config: ExecutorConfig,
    context: ValidatorContext
  ): Promise<boolean> => {
    const result = !!config.chains.find(
      (chain) => chain.chain === order.give.chainId
    );
    const logger = context.logger.child({ validator: "srcChainDefined" });
    logger.info(`approve status: ${result}, chainId: ${order.give.chainId}`);
    return Promise.resolve(result);
  };
};
