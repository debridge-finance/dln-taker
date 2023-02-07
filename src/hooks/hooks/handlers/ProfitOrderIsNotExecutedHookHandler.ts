import { OrderState } from "@debridge-finance/dln-client";
import Web3 from "web3";

import { Notification } from "../../notification/Notification";
import { TelegramNotificationParams } from "../../notification/params/TelegramNotificationParams";
import { TelegramNotification } from "../../notification/TelegramNotification";
import { OrderEstimatedParams } from "../../types/params/OrderEstimatedParams";
import { Hook } from "../Hook";

export const hookHandlerProfitOrderIsNotExecuted = (
  tgKey: string,
  tgChatIds: string[],
  maxDelayInSec: number
): Hook<OrderEstimatedParams> => {
  return new ProfitOrderIsNotExecutedHookHandler(
    tgKey,
    tgChatIds,
    maxDelayInSec
  );
};

class ProfitOrderIsNotExecutedHookHandler extends Hook<OrderEstimatedParams> {
  private readonly telegramNotification: Notification<TelegramNotificationParams>;
  constructor(
    private readonly tgKey: string,
    private readonly tgChatIds: string[],
    private readonly maxDelayInSec: number
  ) {
    super();
    this.telegramNotification = new TelegramNotification(tgKey, tgChatIds);
  }

  async execute(arg: OrderEstimatedParams): Promise<void> {
    if (arg.isLive && arg.estimation.isProfitable) {
      setTimeout(async () => {
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
          this.telegramNotification.notify(
            `Order is not fulfilled more then ${this.maxDelayInSec}`
          );
        }
      }, this.maxDelayInSec);
    }
  }
}
