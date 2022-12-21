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
 * Checks if the address who placed the order on the source chain is in the whitelist.
 * This filter is useful to filter out orders placed by the trusted parties.
 */
export function whitelistedMaker(addresses: string[]): OrderFilterInitializer {
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
      const logger = context.logger.child({ filter: "WhiteListedMarker" });
      const result = addressesBuffer.some((address) =>
        buffersAreEqual(order.maker, address)
      );

      const maker = helpers.bufferToHex(Buffer.from(order.maker));
      logger.info(`approve status: ${result}, maker ${maker}`);
      return Promise.resolve(result);
    };
  };
}
