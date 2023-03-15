import { RejectionReason } from "../../HookEnums";
import { Hooks } from "../../Hooks";
import { Notifier } from "../../notification/Notifier";
import { HookParams } from "../../types/HookParams";
import { HookHandler } from "../HookHandler";

export const orderRejected = (
  notifier: Notifier
): HookHandler<Hooks.OrderRejected> => {
  return async (arg: HookParams<Hooks.OrderRejected>) => {
    const handlerName = "orderRejected";
    const logger = arg.context.logger.child({
      handlerName,
    });
    const reason = RejectionReason[arg.reason];
    const message = `Order #${arg.order.orderId} has been rejected, reason: ${reason}`;
    await notifier.notify(message, { logger });
  };
};
