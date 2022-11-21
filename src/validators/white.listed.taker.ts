import { OrderData } from "@debridge-finance/pmm-client/src/order";
import { ExecutorConfig } from "../config";
import { OrderValidator, ValidatorContext } from "./order.validator";

/**
 * Checks if the order explicitly restricts fulfillment with the specific address which is in the given whitelist. This validator is useful to target OTC-like orders routed through DLN.
 * */
export const whiteListedTaker = (): OrderValidator => {
  return (
    order: OrderData,
    config: ExecutorConfig,
    context: ValidatorContext
  ): Promise<boolean> => {
    const chainConfig = config.chains.find(
      (chain) => chain.chain === order.take.chainId
    )!;
    const taker = context.providers.get(chainConfig.chain)!.address;
    const result = chainConfig.beneficiary === taker;
    context.logger.info(
      `approve status: ${result}, beneficiary ${chainConfig.beneficiary}`
    );
    return Promise.resolve(result);
  };
};
