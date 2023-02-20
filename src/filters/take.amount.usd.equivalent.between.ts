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
 * Checks if the USD equivalent of the order's requested amount (amount that should be supplied to fulfill the order successfully) is in the given range.
 * This filter is useful to filter off uncomfortable volumes, e.g. too low (e.g. less than $10) or too high (e.g., more than $100,000).
 *
 */
export const takeAmountUsdEquivalentBetween = (
  minUSDEquivalent: number,
  maxUSDEquivalent: number
): OrderFilterInitializer => {
  return async (chainId: ChainId, context: OrderFilterInitContext) => {
    return async (
      order: OrderData,
      context: FilterContext
    ): Promise<boolean> => {
      const logger = context.logger.child({
        filter: "takeAmountUsdEquivalentBetween",
      });
      const clientLogger = createClientLogger(logger);
      const takeWeb3 = (
        context.takeChain
          .fulfullProvider as EvmProviderAdapter
      ).connection;
      const takeAddress = helpers.bufferToHex(
        Buffer.from(order.take.tokenAddress)
      );
      logger.debug(`takeAddress=${takeAddress}`);

      const [takePrice, takeDecimals] = await Promise.all([
        context.config.tokenPriceService.getPrice(
          order.take.chainId,
          order.take.tokenAddress,
          { logger: clientLogger }
        ),
        context.config.client.getDecimals(
          order.take.chainId,
          order.take.tokenAddress,
          takeWeb3
        ),
      ]);
      logger.debug(`takePrice=${takePrice}`);
      logger.debug(`takeDecimals=${takeDecimals}`);

      const takeUsdAmount = BigNumber(takePrice)
        .multipliedBy(order.take.amount.toString())
        .dividedBy(new BigNumber(10).pow(takeDecimals))
        .toNumber();
      logger.debug(`takeUsdAmount=${takeUsdAmount}`);

      const result =
        minUSDEquivalent <= takeUsdAmount && takeUsdAmount <= maxUSDEquivalent;
      logger.debug(`result=${result}`);
      logger.info(
        `approve status: ${result}, takeUsdAmount: ${takeUsdAmount.toString()}`
      );
      return Promise.resolve(result);
    };
  };
};
