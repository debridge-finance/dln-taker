import { OrderState } from "@debridge-finance/dln-client";
import { setTimeout } from "timers/promises";
import Web3 from "web3";

import { Hooks } from "../../Hooks";
import { Notifier } from "../../notification/Notifier";
import { OrderEstimatedParams } from "../../types/params/OrderEstimatedParams";
import { HookHandler } from "../HookHandler";

export const orderNotExecutedWithinTimeframe = (
  notifier: Notifier,
  maxDelayInSec: number
): HookHandler<Hooks.OrderEstimated> => {
  return async (args) => {
    const arg = args as OrderEstimatedParams;
    if (arg.isLive && arg.estimation.isProfitable) {
      const logger = arg.context.logger.child({
        hook: "hookHandlerProfitableOrderNotExecutedWithinTimeframe",
      });
      await setTimeout(maxDelayInSec);
      const takeChainId = arg.order.order!.take!.chainId;
      const giveConnection =
        arg.context.config.chains[takeChainId]!.fulfullProvider.connection;

      const takeStatus = await arg.context.config.client.getTakeOrderStatus(
        arg.order.orderId,
        takeChainId,
        {
          web3: giveConnection as Web3,
        }
      );
      if (
        takeStatus?.status === null ||
        takeStatus?.status === undefined ||
        takeStatus?.status === OrderState.NotSet
      ) {
        await notifier.notify(
          `Order is not fulfilled more then ${maxDelayInSec}`,
          { logger }
        );
      }
    }
  };
};
