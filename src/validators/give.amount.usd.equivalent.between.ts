import { ChainId, PMMClient } from "@debridge-finance/pmm-client";
import { OrderData } from "@debridge-finance/pmm-client/src/order";
import { helpers } from "@debridge-finance/solana-utils";
import BigNumber from "bignumber.js";
import Web3 from "web3";

import { ExecutorConfig } from "../config";

import { OrderValidator, ValidatorContext } from "./order.validator";

/**
 * Checks if the USD equivalent of the order's unlock amount (amount given by the maker upon order creation, deducted by the fees) is in the given range. This validator is useful to filter off uncomfortable volumes, e.g. too low (e.g. less than $10) or too high (e.g., more than $100,000).
 */
export const giveAmountUsdEquivalentBetween = (
  minUSDEquivalent: number,
  maxUSDEquivalent: number
): OrderValidator => {
  return async (
    order: OrderData,
    config: ExecutorConfig,
    context: ValidatorContext
  ): Promise<boolean> => {
    const logger = context.logger.child({
      validator: "giveAmountUsdEquivalentBetween",
    });
    let giveWeb3;
    if (order.give.chainId !== ChainId.Solana) {
      giveWeb3 = new Web3(
        config.chains!.find(
          (chainConfig) => chainConfig.chain === order.give.chainId
        )!.chainRpc
      );
    }
    const giveAddress = helpers.bufferToHex(
      Buffer.from(order.give.tokenAddress)
    );
    logger.debug(`giveAddress=${giveAddress}`);

    const [givePrice, giveDecimals] = await Promise.all([
      config.tokenPriceService!.getPrice(order.give.chainId, giveAddress),
      context.client.getDecimals(
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
