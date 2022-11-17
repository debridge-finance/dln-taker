import { PMMClient } from "@debridge-finance/pmm-client";
import { OrderData } from "@debridge-finance/pmm-client/src/order";
import { helpers } from "@debridge-finance/solana-utils";

import { ExecutorConfig } from "../config";

import { OrderValidator, ValidatorContext } from "./order.validator";

/**
 * Checks if the order's locked token is not in the blacklist. This validator is useful to filter off orders that hold undesired and/or illiquid tokens.
 *
 * */
export const blackListedGiveToken = (addresses: string[]): OrderValidator => {
  return (
    order: OrderData,
    config: ExecutorConfig,
    context: ValidatorContext
  ): Promise<boolean> => {
    const logger = context.logger.child({ validator: "blackListedGiveToken" });
    const giveToken = helpers.bufferToHex(Buffer.from(order.give.tokenAddress));
    const result = addresses
      .map((address) => address.toLowerCase())
      .includes(giveToken);

    logger.info(`approve status: ${result}, giveToken ${giveToken}`);
    return Promise.resolve(result);
  };
};
