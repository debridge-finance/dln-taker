import {
  buffersAreEqual,
  ChainId,
  OrderData,
  tokenStringToBuffer,
} from "@debridge-finance/dln-client";
import { helpers } from "@debridge-finance/solana-utils";

import {
  FilterContext,
  OrderFilterInitContext,
  OrderFilterInitializer,
} from "./order.filter";

/**
 * Checks if the order's locked token is not in the blacklist.
 * This filter is useful to filter off orders that hold undesired and/or illiquid tokens.
 */
export function blacklistedGiveToken(
  addresses: string[]
): OrderFilterInitializer {
  return async (chainId: ChainId, context: OrderFilterInitContext) => {
    const addressesBuffer = addresses.map((address) =>
      tokenStringToBuffer(chainId, address)
    );
    return async (order: OrderData, context: FilterContext) => {
      const logger = context.logger.child({
        filter: "blackListedGiveToken",
      });
      const result = addressesBuffer.some((address) =>
        buffersAreEqual(order.give.tokenAddress, address)
      );

      const giveToken = !helpers.bufferToHex(
        Buffer.from(order.give.tokenAddress)
      );
      logger.info(`approve status: ${result}, giveToken ${giveToken}`);
      return Promise.resolve(result);
    };
  };
}
