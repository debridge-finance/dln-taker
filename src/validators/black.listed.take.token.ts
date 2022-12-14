import {buffersAreEqual, ChainId, OrderData, tokenStringToBuffer} from "@debridge-finance/dln-client";

import { helpers } from "@debridge-finance/solana-utils";

import { OrderValidatorInitContext, OrderValidatorInitializer, ValidatorContext } from "./order.validator";

/**
 * Checks if the order's requested token is not in the blacklist. This validator is useful to filter off orders that requested undesired and/or illiquid tokens. *
 *
 */

export function blacklistedTakeToken(addresses: string[]): OrderValidatorInitializer {
  return async (chainId: ChainId, context: OrderValidatorInitContext) => {
    const addressesBuffer = addresses.map((address) => tokenStringToBuffer(chainId, address));
    return async (order: OrderData, context: ValidatorContext) => {
      const logger = context.logger.child({ validator: "blackListedTakeToken" });
      const result = !addressesBuffer.some(address => buffersAreEqual(order.take.tokenAddress, address));

      const takeToken = helpers.bufferToHex(Buffer.from(order.take.tokenAddress));
      logger.info(`approve status: ${result}, takeToken ${takeToken}`);
      return Promise.resolve(result);
    }
  }
}
