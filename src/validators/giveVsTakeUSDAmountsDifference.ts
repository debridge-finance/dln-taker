import { OrderData } from "@debridge-finance/dln-client";
import { helpers } from "@debridge-finance/solana-utils";
import BigNumber from "bignumber.js";

import { ExecutorConfig } from "../config";

import { OrderValidator, ValidatorContext } from "./order.validator";
import { EvmAdapterProvider } from "../providers/evm.provider.adapter";

/**
 * Checks if the USD equivalent of the order's unlock amount (amount given by the maker upon order creation, deducted by the fees) is the given basis points more than the USD equivalent of the order requested amount.
 */
export const giveVsTakeUSDAmountsDifference = (differenceBps: number): OrderValidator => {
  return async (
    order: OrderData,
    config: ExecutorConfig,
    context: ValidatorContext
  ): Promise<boolean> => {
    const { client } = context;
    const logger = context.logger.child({ validator: "giveVsTakeUSDAmountsDifference" });

    const giveWeb3 = (context.providers.get(order.give.chainId) as EvmAdapterProvider).connection;
    const takeWeb3 = (context.providers.get(order.take.chainId) as EvmAdapterProvider).connection;

    const giveAddress = helpers.bufferToHex(
      Buffer.from(order.give.tokenAddress)
    );
    const takeAddress = helpers.bufferToHex(
      Buffer.from(order.take.tokenAddress)
    );

    logger.debug(`giveAddress=${giveAddress}`);
    logger.debug(`takeAddress=${takeAddress}`);

    const [givePrice, takePrice, giveDecimals, takeDecimals] =
      await Promise.all([
        config.tokenPriceService!.getPrice(order.give.chainId, giveAddress),
        config.tokenPriceService!.getPrice(order.take.chainId, takeAddress),
        client.getDecimals(
          order.give.chainId,
          order.give.tokenAddress,
          giveWeb3
        ),
        client.getDecimals(
          order.take.chainId,
          order.take.tokenAddress,
          takeWeb3
        ),
      ]);

    logger.debug(`givePrice=${givePrice}`);
    logger.debug(`takePrice=${takePrice}`);
    logger.debug(`giveDecimals=${giveDecimals}`);
    logger.debug(`takeDecimals=${takeDecimals}`);

    const giveUsdAmount = BigNumber(givePrice)
      .multipliedBy(order.give.amount.toString())
      .dividedBy(new BigNumber(10).pow(giveDecimals));
    logger.debug(`giveUsdAmount=${giveUsdAmount}`);

    const takeUsdAmount = BigNumber(takePrice)
      .multipliedBy(order.take.amount.toString())
      .dividedBy(new BigNumber(10).pow(takeDecimals));
    logger.debug(`takeDecimals=${takeDecimals}`);

    const profitability = takeUsdAmount
      .multipliedBy(differenceBps)
      .div(100 ** 2);
    logger.debug(`profitability=${profitability}`);

    const result = profitability.lte(giveUsdAmount.div(takeUsdAmount));
    logger.debug(`result=${result}`);

    logger.info(
      `approve status: ${result}, giveUsdAmount: ${giveUsdAmount.toString()}, takeUsdAmount: ${takeUsdAmount.toString()}`
    );
    return Promise.resolve(result);
  };
};
