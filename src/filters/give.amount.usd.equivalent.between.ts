import { ChainId, OrderData } from "@debridge-finance/dln-client";
import { helpers } from "@debridge-finance/solana-utils";
import BigNumber from "bignumber.js";

import { createClientLogger } from "../logger";
import { EvmProviderAdapter } from "../providers/evm.provider.adapter";

import {
  FilterContext,
  OrderFilterInitContext,
  OrderFilterInitializer,
} from "./order.filter";

/**
 * Checks if the USD equivalent of the order's unlock amount (amount given by the maker upon order creation, deducted by the fees) is in the given range.
 * This filter is useful to filter off uncomfortable volumes, e.g. too low (e.g. less than $10) or too high (e.g., more than $100,000).
 */
export const giveAmountUsdEquivalentBetween = (
  minUSDEquivalent: number,
  maxUSDEquivalent: number
): OrderFilterInitializer => {
  return async (chainId: ChainId, context: OrderFilterInitContext) => {
    return async (
      order: OrderData,
      context: FilterContext
    ): Promise<boolean> => {
      const logger = context.logger.child({
        filter: "giveAmountUsdEquivalentBetween",
      });
      const clientLogger = createClientLogger(logger);
      const giveWeb3 = (context.giveChain.fulfullProvider as EvmProviderAdapter)
        .connection;
      const giveAddress = helpers.bufferToHex(
        Buffer.from(order.give.tokenAddress)
      );
      logger.debug(`giveAddress=${giveAddress}`);

      const [givePrice, giveDecimals] = await Promise.all([
        context.config.tokenPriceService.getPrice(
          order.give.chainId,
          order.give.tokenAddress,
          { logger: clientLogger }
        ),
        context.config.client.getDecimals(
          order.give.chainId,
          order.give.tokenAddress,
          giveWeb3
        ),
      ]);
      logger.debug(`givePrice=${givePrice}`);
      logger.debug(`giveDecimals=${giveDecimals}`);

      const giveUsdAmount = BigNumber(givePrice)
        .multipliedBy(order.give.amount.toString())
        .dividedBy(new BigNumber(10).pow(giveDecimals))
        .toNumber();
      logger.debug(`giveUsdAmount=${giveUsdAmount}`);

      const result =
        minUSDEquivalent <= giveUsdAmount && giveUsdAmount <= maxUSDEquivalent;
      logger.debug(`result=${result}`);
      logger.info(
        `approve status: ${result}, giveUsdAmount: ${giveUsdAmount.toString()}`
      );
      return Promise.resolve(result);
    };
  };
};
