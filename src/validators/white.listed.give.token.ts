import {buffersAreEqual, ChainId, OrderData, tokenStringToBuffer} from "@debridge-finance/dln-client";

import { helpers } from "@debridge-finance/solana-utils";

import { ExecutorLaunchConfig } from "../config";

import { OrderValidator, OrderValidatorInitContext, OrderValidatorInitializer, ValidatorContext } from "./order.validator";

/**
 * Checks if the address who placed the order on the source chain is in the whitelist. This validator is useful to filter out orders placed by the trusted parties.
 */
export function whitelistedGiveToken(addresses: string[]): OrderValidatorInitializer {
  return async (chainId: ChainId, context: OrderValidatorInitContext): Promise<OrderValidator> => {
    const addressesBuffer = addresses.map((address) => tokenStringToBuffer(chainId, address));
    return async (
      order: OrderData,
      context: ValidatorContext
    ): Promise<boolean> => {
      const logger = context.logger.child({ validator: "WhiteListedGiveToken" });
      const result = addressesBuffer.some(address => buffersAreEqual(order.give.tokenAddress, address));

      const giveToken = helpers.bufferToHex(Buffer.from(order.give.tokenAddress));
      logger.info(`approve status: ${result}, giveToken ${giveToken}`);
      return Promise.resolve(result);
    }
  }
}
