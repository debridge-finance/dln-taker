import { PostponingReason } from "../../HookEnums";
import { Hooks } from "../../Hooks";
import { Notifier } from "../../notification/Notifier";
import { HookParams } from "../../types/params/HookParams";
import { OrderPostponedParams } from "../../types/params/OrderPostponedParams";
import { HookHandler } from "../HookHandler";

export const orderPostponed = (
  notifier: Notifier
): HookHandler<Hooks.OrderPostponed> => {
  return async (args: HookParams<Hooks.OrderPostponed>) => {
    const arg = args as OrderPostponedParams;
    const logger = arg.context.logger.child({
      hook: "hookHandlerOrderPostponed",
    });
    if (arg.reason === PostponingReason.NON_PROFITABLE && !arg.isLive) {
      return;
    }

    const reason = PostponingReason[arg.reason];
    const message = `Order #${arg.order.orderId} has been postponed, reason: ${reason} message: ${arg.message}`;
    await notifier.notify(message, { logger });
  };
};
