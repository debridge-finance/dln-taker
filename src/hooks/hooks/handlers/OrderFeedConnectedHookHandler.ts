import { Notification } from "../../notification/Notification";
import { TelegramNotificationParams } from "../../notification/params/TelegramNotificationParams";
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
  private readonly telegramNotification: Notification<TelegramNotificationParams>;
  constructor(
    private readonly tgKey: string,
    private readonly tgChatIds: string[]
  ) {
    super();
    this.telegramNotification = new TelegramNotification(tgKey);
  }

  async execute(arg: OrderFeedConnectedParams): Promise<void> {
    const message = `Websocket connected after ${arg.timeSinceLastDisconnect} seconds`;
    await this.telegramNotification.notify(message, {
      chatIds: this.tgChatIds,
    });
  }
}
