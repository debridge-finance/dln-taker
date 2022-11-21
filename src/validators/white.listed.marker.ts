import { OrderData } from "@debridge-finance/pmm-client/src/order";
import { helpers } from "@debridge-finance/solana-utils";

import { ExecutorConfig } from "../config";

import { OrderValidator, ValidatorContext } from "./order.validator";

/**
 * Checks if the address who placed the order on the source chain is in the whitelist. This validator is useful to filter out orders placed by the trusted parties.
 */
export const whiteListedMarker = (addresses: string[]): OrderValidator => {
  return (
    order: OrderData,
    config: ExecutorConfig,
    context: ValidatorContext
  ): Promise<boolean> => {
    const logger = context.logger.child({ validator: "whiteListedMarker" });
    const maker = helpers.bufferToHex(Buffer.from(order.maker));
    const result = addresses
      .map((address) => address.toLowerCase())
      .includes(maker);

    logger.info(`approve status: ${result}, maker ${maker}`);
    return Promise.resolve(result);
  };
};
