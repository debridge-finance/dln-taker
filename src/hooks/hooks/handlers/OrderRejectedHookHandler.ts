import { Notification } from "../../notification/Notification";
import { TelegramNotificationParams } from "../../notification/params/TelegramNotificationParams";
import { TelegramNotification } from "../../notification/TelegramNotification";
import { OrderRejectedParams } from "../../types/params/OrderRejectedParams";
import { Hook } from "../Hook";

export const hookHandlerOrderRejected = (
  tgKey: string,
  tgChatIds: string[]
): Hook<OrderRejectedParams> => {
  return new HookHandlerOrderRejected(tgKey, tgChatIds);
};

class HookHandlerOrderRejected extends Hook<OrderRejectedParams> {
  private readonly telegramNotification: Notification<TelegramNotificationParams>;
  constructor(
    private readonly tgKey: string,
    private readonly tgChatIds: string[]
  ) {
    super();
    this.telegramNotification = new TelegramNotification(tgKey);
  }

  async execute(arg: OrderRejectedParams): Promise<void> {
    const message = `Order #${arg.order.orderId} has been rejected, reason: ${arg.reason}`;
    await this.telegramNotification.notify(message, {
      chatIds: this.tgChatIds,
    });
  }
}
