import BigNumber from "bignumber.js";
import Web3 from "web3";

import { createClientLogger } from "../../../logger";
import { Notification } from "../../notification/Notification";
import { TwitterNotification } from "../../notification/TwitterNotification";
import { OrderEstimatedParams } from "../../types/params/OrderEstimatedParams";
import { Hook } from "../Hook";

export const hookHandlerBigOrderIsProfit = (
  consumerKey: string,
  consumerSecret: string,
  accessTokenKey: string,
  accessTokenSecret: string,
  minUsdAmount: number
): Hook<OrderEstimatedParams> => {
  return new BigOrderIsProfitHookHandler(
    consumerKey,
    consumerSecret,
    accessTokenKey,
    accessTokenSecret,
    minUsdAmount
  );
};

class BigOrderIsProfitHookHandler extends Hook<OrderEstimatedParams> {
  private readonly twitterNotification: Notification;
  constructor(
    consumerKey: string,
    consumerSecret: string,
    accessTokenKey: string,
    accessTokenSecret: string,
    private readonly minUsdAmount: number
  ) {
    super();
    this.twitterNotification = new TwitterNotification(
      consumerKey,
      consumerSecret,
      accessTokenKey,
      accessTokenSecret
    );
  }

  async execute(arg: OrderEstimatedParams): Promise<void> {
    if (arg.isLive && arg.estimation.isProfitable) {
      const order = arg.order.order;
      const config = arg.context.config;
      const giveChainId = order!.take!.chainId;
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

      if (giveUsdAmount > this.minUsdAmount) {
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
        }: gives ${giveAmountWithoutDecimals} ${giveTokenSymbol} on ${giveChainId}, takes ${takeAmountWithoutDecimals} ${takeTokenSymbol} on ${takeChainId}}. Provide ${reservedAmountWithoutDecimals} ${{
          reservedTokenSymbol,
        }} on ${takeChainId} and earn ${
          giveAmountWithoutDecimals - reservedAmountWithoutDecimals
        } ${reservedTokenSymbol}`;

        this.twitterNotification.notify(message);
      }
    }
  }
}
