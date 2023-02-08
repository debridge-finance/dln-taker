import { Notification } from "../../notification/Notification";
import { TelegramNotification } from "../../notification/TelegramNotification";
import { PostponingReasonEnum } from "../../PostponingReasonEnum";
import { OrderPostponedParams } from "../../types/params/OrderPostponedParams";
import { Hook } from "../Hook";

export const hookHandlerOrderPostponed = (
  tgKey: string,
  tgChatIds: string[]
): Hook<OrderPostponedParams> => {
  return new OrderPostponedHookHandler(tgKey, tgChatIds);
};

class OrderPostponedHookHandler extends Hook<OrderPostponedParams> {
  private readonly telegramNotification: Notification;
  constructor(tgKey: string, tgChatIds: string[]) {
    super();
    this.telegramNotification = new TelegramNotification(tgKey, tgChatIds);
  }

  async execute(arg: OrderPostponedParams): Promise<void> {
    if (arg.reason === PostponingReasonEnum.NON_PROFITABLE && !arg.isLive) {
      return;
    }
    const message = `Order #${arg.order.orderId} has been postponed, reason: ${arg.reason} message: ${arg.message}`;
    await this.telegramNotification.notify(message);
  }
}
