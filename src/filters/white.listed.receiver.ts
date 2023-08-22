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
  OrderFilterInitializer,
} from "./order.filter";

/**
 * Checks if the receiver address (who will take funds upon successful order fulfillment) is in the whitelist.
 * This filter is useful to filter out orders placed by the trusted parties.
 */
export function whitelistedReceiver(
  addresses: string[]
): OrderFilterInitializer {
  return async (
    chainId: ChainId,
    /* context: OrderFilterInitContext */{}
  ): Promise<OrderFilter> => {
    const addressesBuffer = addresses.map((address) =>
      tokenStringToBuffer(chainId, address)
    );
    return async (
      order: OrderData,
      context: FilterContext
    ): Promise<boolean> => {
      const logger = context.logger.child({ filter: "WhiteListedReceiver" });
      const result = addressesBuffer.some((address) =>
        buffersAreEqual(order.receiver, address)
      );

      const receiver = helpers.bufferToHex(Buffer.from(order.receiver));
      logger.info(`approve status: ${result}, receiver ${receiver}`);
      return Promise.resolve(result);
    };
  };
}
