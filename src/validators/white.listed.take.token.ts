import {buffersAreEqual, ChainId, OrderData, tokenStringToBuffer} from "@debridge-finance/dln-client";

import { helpers } from "@debridge-finance/solana-utils";
import { OrderValidator, OrderValidatorInitContext, OrderValidatorInitializer, ValidatorContext } from "./order.validator";

/**
 * Checks if the order's requested token is in the whitelist. This validator is useful to target orders that request specific tokens.
 */
export function whitelistedTakeToken(addresses: string[]): OrderValidatorInitializer {
  return async (chainId: ChainId, context: OrderValidatorInitContext): Promise<OrderValidator> => {
    const addressesBuffer = addresses.map((address) => tokenStringToBuffer(chainId, address));
    return async (
      order: OrderData,
      context: ValidatorContext
    ): Promise<boolean> => {
      const logger = context.logger.child({ validator: "WhiteListedTakeToken" });
      const result = addressesBuffer.some(address => buffersAreEqual(order.take.tokenAddress, address));

      const takeToken = helpers.bufferToHex(Buffer.from(order.take.tokenAddress));
      logger.info(`approve status: ${result}, takeToken ${takeToken}`);
      return Promise.resolve(result);
    }
  }
}