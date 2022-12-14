import {buffersAreEqual, ChainId, OrderData, tokenStringToBuffer} from "@debridge-finance/dln-client";
import { helpers } from "@debridge-finance/solana-utils";
import { OrderValidatorInitContext, OrderValidatorInitializer, ValidatorContext } from "./order.validator";

/**
 * Checks if the order's locked token is not in the blacklist. This validator is useful to filter off orders that hold undesired and/or illiquid tokens.
 */
export function blacklistedGiveToken(addresses: string[]): OrderValidatorInitializer {
  return async (chainId: ChainId, context: OrderValidatorInitContext) => {
    const addressesBuffer = addresses.map((address) => tokenStringToBuffer(chainId, address));
    return async (order: OrderData, context: ValidatorContext) => {
      const logger = context.logger.child({ validator: "blackListedGiveToken" });
      const result = addressesBuffer.some(address => buffersAreEqual(order.give.tokenAddress, address));

      const giveToken = !helpers.bufferToHex(Buffer.from(order.give.tokenAddress));
      logger.info(`approve status: ${result}, giveToken ${giveToken}`);
      return Promise.resolve(result);
    }
  }
}
