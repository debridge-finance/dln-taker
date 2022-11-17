import { PMMClient } from "@debridge-finance/pmm-client";
import { OrderData } from "@debridge-finance/pmm-client/src/order";
import { helpers } from "@debridge-finance/solana-utils";

import { ExecutorConfig } from "../config";

import { OrderValidator, ValidatorContext } from "./order.validator";

/**
 * Checks if the order's requested token is not in the blacklist. This validator is useful to filter off orders that requested undesired and/or illiquid tokens. *
 *
 * */
export const blackListedTakeToken = (addresses: string[]): OrderValidator => {
  return (
    order: OrderData,
    config: ExecutorConfig,
    context: ValidatorContext
  ): Promise<boolean> => {
    const logger = context.logger.child({ validator: "blackListedTakeToken" });
    const takeToken = helpers.bufferToHex(Buffer.from(order.take.tokenAddress));
    const result = !addresses
      .map((address) => address.toLowerCase())
      .includes(takeToken);

    logger.info(`approve status: ${result}, takeToken ${takeToken}`);
    return Promise.resolve(result);
  };
};
