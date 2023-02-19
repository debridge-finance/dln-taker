import { ChainId } from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";
import Web3 from "web3";

import { createClientLogger } from "../../../logger";
import { Hooks } from "../../Hooks";
import { Notifier } from "../../notification/Notifier";
import { HookParams } from "../../types/params/HookParams";
import { OrderEstimatedParams } from "../../types/params/OrderEstimatedParams";
import { HookHandler } from "../HookHandler";

export const announceLargeOrder = (
  notifier: Notifier,
  minUsdAmount: number
): HookHandler<Hooks.OrderEstimated> => {
  return async (args: HookParams<Hooks.OrderEstimated>) => {
    const arg = args as OrderEstimatedParams;
    if (arg.isLive && arg.estimation.isProfitable) {
      const logger = arg.context.logger.child({
        hook: "hookHandlerBigOrderIsProfit",
      });

      logger.debug(`Execution is started`);
      const order = arg.order.order;
      const config = arg.context.config;
      const giveChainId = order!.give!.chainId;
      const giveConnection =
        config.chains[giveChainId]!.fulfullProvider.connection;
      const [giveUsdPrice, giveDecimals] = await Promise.all([
        config.tokenPriceService.getPrice(
          giveChainId,
          order!.give.tokenAddress,
          { logger: createClientLogger(arg.context.logger) }
        ),
        config.client.getDecimals(
          giveChainId,
          order!.give.tokenAddress,
          giveConnection as Web3
        ),
      ]);

      const giveUsdAmount = new BigNumber(order!.give.amount.toString())
        .multipliedBy(giveUsdPrice)
        .div(new BigNumber(10, giveDecimals))
        .toNumber();

      if (giveUsdAmount < minUsdAmount) return;

      logger.debug(
        `Order give amount is big than set value(${giveUsdAmount} > ${minUsdAmount})`
      );
      const takeChainId = order!.take!.chainId;
      const takeConnection =
        config.chains[takeChainId]!.fulfullProvider.connection;
      const [
        takeDecimals,
        reserveDecimals,
        giveTokenSymbol,
        takeTokenSymbol,
        reservedTokenSymbol,
      ] = await Promise.all([
        config.client.getDecimals(
          takeChainId,
          order!.take.tokenAddress,
          takeConnection as Web3
        ),
        config.client.getDecimals(takeChainId, arg.estimation.reserveToken),
        config.client.getTokenSymbol(
          giveChainId,
          order!.give.tokenAddress,
          giveConnection as Web3
        ),
        config.client.getTokenSymbol(
          takeChainId,
          order!.take.tokenAddress,
          takeConnection as Web3
        ),
        config.client.getTokenSymbol(
          takeChainId,
          arg.estimation.reserveToken,
          takeConnection as Web3
        ),
      ]);

      const giveAmountWithoutDecimals = new BigNumber(
        order!.give.amount.toString()
      )
        .div(new BigNumber(10, giveDecimals))
        .toNumber();
      const takeAmountWithoutDecimals = new BigNumber(
        order!.take.amount.toString()
      )
        .div(new BigNumber(10, takeDecimals))
        .toNumber();
      const reservedAmountWithoutDecimals = new BigNumber(
        arg.estimation.requiredReserveAmount.toString()
      )
        .div(new BigNumber(10, reserveDecimals))
        .toNumber();

      const message = `Order ${
        arg.order.orderId
      }: gives ${giveAmountWithoutDecimals} ${giveTokenSymbol} on ${
        ChainId[giveChainId]
      }, takes ${takeAmountWithoutDecimals} ${takeTokenSymbol} on ${takeChainId}}. Provide ${reservedAmountWithoutDecimals} ${{
        reservedTokenSymbol,
      }} on ${ChainId[takeChainId]} and earn ${
        giveAmountWithoutDecimals - reservedAmountWithoutDecimals
      } ${reservedTokenSymbol}`;

      await notifier.notify(message, { logger });
    }
  };
};
