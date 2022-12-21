import {
  buffersAreEqual,
  ChainId,
  OrderData,
  tokenStringToBuffer,
} from "@debridge-finance/dln-client";
import { helpers } from "@debridge-finance/solana-utils";

import {
  FilterContext,
  OrderFilter,
  OrderFilterInitContext,
  OrderFilterInitializer,
} from "./order.filter";

/**
 * Checks if the order's requested token is in the whitelist.
 * This filter is useful to target orders that request specific tokens.
 */
export function whitelistedTakeToken(
  addresses: string[]
): OrderFilterInitializer {
  return async (
    chainId: ChainId,
    context: OrderFilterInitContext
  ): Promise<OrderFilter> => {
    const addressesBuffer = addresses.map((address) =>
      tokenStringToBuffer(chainId, address)
    );
    return async (
      order: OrderData,
      context: FilterContext
    ): Promise<boolean> => {
      const logger = context.logger.child({
        filter: "WhiteListedTakeToken",
      });
      const result = addressesBuffer.some((address) =>
        buffersAreEqual(order.take.tokenAddress, address)
      );

      const takeToken = helpers.bufferToHex(
        Buffer.from(order.take.tokenAddress)
      );
      logger.info(`approve status: ${result}, takeToken ${takeToken}`);
      return Promise.resolve(result);
    };
  };
}
