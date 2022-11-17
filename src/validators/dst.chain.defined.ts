import {OrderData} from "@debridge-finance/pmm-client/src/order";
import {PMMClient} from "@debridge-finance/pmm-client";
import {ExecutorConfig} from "../config";
import {OrderValidator, ValidatorContext} from "./order.validator";

/**
 * Checks if the destination chain for the given order is defined in the config.
 * This validator is made for convenience because it won't be possible to fulfill an order if its destination chain is not defined in the configuration file.
 */
export const dstChainDefined = (): OrderValidator => {
  return (order: OrderData, config: ExecutorConfig, context: ValidatorContext): Promise<boolean> => {
    const result = !!config.chains.find(chain => chain.chain === order.take.chainId);
    const logger = context.logger.child({ validator: 'dstChainDefined' });
    logger.info(`approve status: ${result}, chainId: ${order.take.chainId}`);
    return Promise.resolve(result);
  };
}
