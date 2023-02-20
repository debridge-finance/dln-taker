import { ChainId, OrderData } from "@debridge-finance/dln-client";

import {
  FilterContext,
  OrderFilterInitContext,
  OrderFilterInitializer,
} from "./order.filter";

/**
 * Prevents orders coming to the given chain from fulfillment.
 * This filter is useful to filter off orders that are targeted to the chain you don't want to fulfill in, which is still needed to be presented in the configuration file to enable orders coming from this chain.
 */
export function disableFulfill(): OrderFilterInitializer {
  return async (chainId: ChainId, context: OrderFilterInitContext) => {
    return async (order: OrderData, context: FilterContext) => {
      const result = false;
      const logger = context.logger.child({ filter: "disableFulfill" });
      logger.info(`approve status: ${result}`);
      return Promise.resolve(false);
    };
  };
}
