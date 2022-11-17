import { PMMClient } from "@debridge-finance/pmm-client";
import { OrderData } from "@debridge-finance/pmm-client/src/order";
import { helpers } from "@debridge-finance/solana-utils";

import { ExecutorConfig } from "../config";

import { OrderValidator, ValidatorContext } from "./order.validator";

/**
 * Checks if the order's requested token is in the whitelist. This validator is useful to target orders that request specific tokens.
 * */
export const whiteListedTakeToken = (addresses: string[]): OrderValidator => {
  return (
    order: OrderData,
    config: ExecutorConfig,
    context: ValidatorContext
  ): Promise<boolean> => {
    const logger = context.logger.child({ validator: "whiteListedTakeToken" });
    const takeToken = helpers.bufferToHex(Buffer.from(order.take.tokenAddress));
    const result = addresses
      .map((address) => address.toLowerCase())
      .includes(takeToken);

    logger.info(`approve status: ${result}, takeToken ${takeToken}`);
    return Promise.resolve(result);
  };
};
