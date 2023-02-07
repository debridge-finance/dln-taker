import { Notification } from "./Notification";
import { TelegramNotificationParams } from "./params/TelegramNotificationParams";

export class TelegramNotification extends Notification<TelegramNotificationParams> {
  constructor(
    private readonly tgKey: string,
    private readonly tgChatIds: string[]
  ) {
    super();
  }

  async notify(message: string): Promise<void> {
    await Promise.all(
      this.tgChatIds.map((chatId) => {
        return fetch(`https://api.telegram.org/bot${this.tgKey}/sendMessage`, {
          method: "POST",
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
          }),
        });
      })
    );
  }
}
