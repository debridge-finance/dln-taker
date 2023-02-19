import { NotificationContext, Notifier } from "./Notifier";

export class TelegramNotifier extends Notifier {
  constructor(
    private readonly tgKey: string,
    private readonly tgChatIds: string[]
  ) {
    super();
  }

  async notify(message: string, context: NotificationContext): Promise<void> {
    const logger = context.logger.child({
      notification: TelegramNotifier.name,
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
