import { OrderState } from "@debridge-finance/dln-client";
import { setTimeout } from "timers/promises";
import Web3 from "web3";

import { Database } from "../../database/Database";
import { Hooks } from "../../Hooks";
import { Notifier } from "../../notification/Notifier";
import { HookHandler } from "../HookHandler";

export const orderNotExecutedWithinTimeframe = (
  notifier: Notifier,
  database: Database,
  maxDelayInSec: number
): HookHandler<Hooks.OrderEstimated> => {
  return async (arg) => {
    const handlerName = "orderNotExecutedWithinTimeframe";
    const logger = arg.context.logger.child({
      handlerName,
    });

    await database.init();

    const isProcessed = await database.check(arg.order.orderId, handlerName);
    if (isProcessed) {
      logger.warn(`Order was processed`);
      return;
    }

    if (arg.estimation.isProfitable) {
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
        await database.save(arg.order.orderId, handlerName);
      }
    }
  };
};
