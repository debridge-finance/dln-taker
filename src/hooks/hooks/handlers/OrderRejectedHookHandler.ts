import { Notification } from "../../notification/Notification";
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
  private readonly telegramNotification: Notification;
  constructor(tgKey: string, tgChatIds: string[]) {
    super();
    this.telegramNotification = new TelegramNotification(tgKey, tgChatIds);
  }

  async execute(arg: OrderRejectedParams): Promise<void> {
    const logger = arg.context.logger.child({
      hook: HookHandlerOrderRejected.name,
    });
    const message = `Order #${arg.order.orderId} has been rejected, reason: ${arg.reason}`;
    await this.telegramNotification.notify(message, { logger });
  }
}
