import { Notification, NotificationContext } from "./Notification";

export class TelegramNotification extends Notification {
  constructor(
    private readonly tgKey: string,
    private readonly tgChatIds: string[]
  ) {
    super();
  }

  async notify(message: string, context: NotificationContext): Promise<void> {
    const logger = context.logger.child({
      notification: TelegramNotification.name,
    });
    for (const chatId of this.tgChatIds) {
      await fetch(`https://api.telegram.org/bot${this.tgKey}/sendMessage`, {
        method: "POST",
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
        }),
      });
      logger.debug(`Notification ${message} is sent`);
    }
  }
}
