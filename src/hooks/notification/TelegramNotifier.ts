import { NotificationContext, Notifier } from "./Notifier";
import axios from "axios";

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
      await axios.post(`https://api.telegram.org/bot${this.tgKey}/sendMessage`, {
        chat_id: chatId,
        text: message,
        parse_mode: "HTML"
      });
      logger.debug(`Notification ${message} is sent`);
    }
  }
}