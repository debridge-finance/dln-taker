import { ChainId } from "@debridge-finance/pmm-client";
import { OrderData } from "@debridge-finance/pmm-client/src/order";

import { ExecutorConfig } from "../config";
import { createWeb3WithPrivateKey } from "../processors/utils/create.web3.with.private.key";

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
    let result = false;
    if (chainConfig.chain === ChainId.Solana) {
      // todo
    } else {
      const web3 = createWeb3WithPrivateKey(
        chainConfig.chainRpc,
        chainConfig.takerPrivateKey
      );
      result = web3.eth.defaultAccount === chainConfig.beneficiary;
    }
    context.logger.info(
      `approve status: ${result}, beneficiary ${chainConfig.beneficiary}`
    );
    return Promise.resolve(result);
  };
};
