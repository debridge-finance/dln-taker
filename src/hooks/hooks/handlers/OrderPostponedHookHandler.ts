import { Notification } from "../../notification/Notification";
import { TelegramNotificationParams } from "../../notification/params/TelegramNotificationParams";
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
  private readonly telegramNotification: Notification<TelegramNotificationParams>;
  constructor(
    private readonly tgKey: string,
    private readonly tgChatIds: string[]
  ) {
    super();
    this.telegramNotification = new TelegramNotification(tgKey);
  }

  async execute(arg: OrderPostponedParams): Promise<void> {
    if (arg.reason === PostponingReasonEnum.NON_PROFITABLE && !arg.isLive) {
      return;
    }
    const message = `Order #${arg.order.orderId} has been postponed, reason: ${arg.reason} message: ${arg.message}`;
    await this.telegramNotification.notify(message, {
      chatIds: this.tgChatIds,
    });
  }
}
