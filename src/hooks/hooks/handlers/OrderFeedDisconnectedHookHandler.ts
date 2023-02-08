import { Notification } from "../../notification/Notification";
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
  private readonly telegramNotification: Notification;
  constructor(tgKey: string, tgChatIds: string[]) {
    super();
    this.telegramNotification = new TelegramNotification(tgKey, tgChatIds);
  }

  async execute(arg: HookParams): Promise<void> {
    const message = `Websocket connection is lost!`;
    await this.telegramNotification.notify(message);
  }
}
