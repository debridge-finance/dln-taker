import {buffersAreEqual, ChainId, OrderData, tokenStringToBuffer} from "@debridge-finance/dln-client";

import { helpers } from "@debridge-finance/solana-utils";

import { ExecutorLaunchConfig } from "../config";

import { OrderValidator, OrderValidatorInitContext, OrderValidatorInitializer, ValidatorContext } from "./order.validator";

/**
 * Checks if the address who placed the order on the source chain is in the whitelist. This validator is useful to filter out orders placed by the trusted parties.
 */
export function whitelistedMaker(addresses: string[]): OrderValidatorInitializer {
  return async (chainId: ChainId, context: OrderValidatorInitContext): Promise<OrderValidator> => {
    const addressesBuffer = addresses.map((address) => tokenStringToBuffer(chainId, address));
    return async (
      order: OrderData,
      context: ValidatorContext
    ): Promise<boolean> => {
      const logger = context.logger.child({ validator: "WhiteListedMarker" });
      const result = addressesBuffer.some(address => buffersAreEqual(order.maker, address));

      const maker = helpers.bufferToHex(Buffer.from(order.maker));
      logger.info(`approve status: ${result}, maker ${maker}`);
      return Promise.resolve(result);
    }
  }
}