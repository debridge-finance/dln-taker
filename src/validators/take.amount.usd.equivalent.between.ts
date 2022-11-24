import { ChainId, OrderData } from "@debridge-finance/dln-client";

import { helpers } from "@debridge-finance/solana-utils";
import BigNumber from "bignumber.js";

import { ExecutorConfig } from "../config";

import { OrderValidator, ValidatorContext } from "./order.validator";
import {EvmAdapterProvider} from "../providers/evm.provider.adapter";

/**
 * Checks if the USD equivalent of the order's requested amount (amount that should be supplied to fulfill the order successfully) is in the given range. This validator is useful to filter off uncomfortable volumes, e.g. too low (e.g. less than $10) or too high (e.g., more than $100,000).
 *
 */
export const takeAmountUsdEquivalentBetween = (
  minUSDEquivalent: number,
  maxUSDEquivalent: number
): OrderValidator => {
  return async (
    order: OrderData,
    config: ExecutorConfig,
    context: ValidatorContext
  ): Promise<boolean> => {
    const logger = context.logger.child({
      validator: "takeAmountUsdEquivalentBetween",
    });
    let taleWeb3 = (context.providers.get(order.take.chainId) as EvmAdapterProvider).connection;
    const takeAddress = helpers.bufferToHex(
      Buffer.from(order.take.tokenAddress)
    );
    logger.debug(`takeAddress=${takeAddress}`);

    const [takePrice, takeDecimals] = await Promise.all([
      config.tokenPriceService!.getPrice(order.take.chainId, takeAddress),
      context.client.getDecimals(
        order.take.chainId,
        order.take.tokenAddress,
        taleWeb3
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
