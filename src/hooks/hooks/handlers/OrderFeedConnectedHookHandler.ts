import { Notification } from "../../notification/Notification";
import { TelegramNotification } from "../../notification/TelegramNotification";
import { OrderFeedConnectedParams } from "../../types/params/OrderFeedConnectedParams";
import { Hook } from "../Hook";

export const hookHandlerOrderFeedConnected = (
  tgKey: string,
  tgChatIds: string[]
): Hook<OrderFeedConnectedParams> => {
  return new HookHandlerOrderFeedConnected(tgKey, tgChatIds);
};

class HookHandlerOrderFeedConnected extends Hook<OrderFeedConnectedParams> {
  private readonly telegramNotification: Notification;
  constructor(tgKey: string, tgChatIds: string[]) {
    super();
    this.telegramNotification = new TelegramNotification(tgKey, tgChatIds);
  }

  async execute(arg: OrderFeedConnectedParams): Promise<void> {
    const message = `Websocket connected after ${arg.timeSinceLastDisconnect} seconds`;
    await this.telegramNotification.notify(message);
  }
}
