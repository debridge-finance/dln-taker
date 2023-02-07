import { Notification } from "../../notification/Notification";
import { TelegramNotificationParams } from "../../notification/params/TelegramNotificationParams";
import { TelegramNotification } from "../../notification/TelegramNotification";
import { HookParams } from "../../types/params/HookParams";
import { Hook } from "../Hook";

export const hookHandlerOrderFeedDisconnected = (
  tgKey: string,
  tgChatIds: string[]
): Hook<HookParams> => {
  return new HookHandlerOrderFeedDisconnected(tgKey, tgChatIds);
};

class HookHandlerOrderFeedDisconnected extends Hook<HookParams> {
  private readonly telegramNotification: Notification<TelegramNotificationParams>;
  constructor(
    private readonly tgKey: string,
    private readonly tgChatIds: string[]
  ) {
    super();
    this.telegramNotification = new TelegramNotification(tgKey);
  }

  async execute(arg: HookParams): Promise<void> {
    const message = `Websocket connection is lost!`;
    await this.telegramNotification.notify(message, {
      chatIds: this.tgChatIds,
    });
  }
}
