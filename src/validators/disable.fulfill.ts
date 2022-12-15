import { ChainId, OrderData } from "@debridge-finance/dln-client";
import {  OrderValidatorInitContext, OrderValidatorInitializer, ValidatorContext } from "./order.validator";

/**
 * Prevents orders coming to the given chain from fulfillment.
 * This validator is useful to filter off orders that are targeted to the chain you don't want to fulfill in, which is still needed to be presented in the configuration file to enable orders coming from this chain.
 */
export function disableFulfill(): OrderValidatorInitializer {
  return async (chainId: ChainId, context: OrderValidatorInitContext) => {
    return async (order: OrderData, context: ValidatorContext) => {
      const result = false;
      const logger = context.logger.child({ validator: "disableFulfill" });
      logger.info(`approve status: ${result}`);
      return Promise.resolve(false);
    }
  }
}
