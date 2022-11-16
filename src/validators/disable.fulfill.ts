import {OrderData} from "@debridge-finance/pmm-client/src/order";
import {PMMClient} from "@debridge-finance/pmm-client";
import {ExecutorConfig} from "../config";
import {OrderValidator, ValidatorContext} from "./order.validator";

/**
 * Prevents orders coming to the given chain from fulfillment.
 * This validator is useful to filter off orders that are targeted to the chain you don't want to fulfill in, which is still needed to be presented in the configuration file to enable orders coming from this chain.
 */
export const disableFulfill = (): OrderValidator => {
  return (order: OrderData, config: ExecutorConfig, context: ValidatorContext): Promise<boolean> => {
    const result = false;
    const logger = context.logger.child({ validator: 'disableFulfill' });
    context.logger.info(`approve status: ${result}`);
    return Promise.resolve(result);
  };
}
