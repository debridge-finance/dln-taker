import { RejectionReason } from "../../HookEnums";
import { Hooks } from "../../Hooks";
import { Notifier } from "../../notification/Notifier";
import { HookParams } from "../../types/params/HookParams";
import { OrderRejectedParams } from "../../types/params/OrderRejectedParams";
import { HookHandler } from "../HookHandler";

export const orderRejected = (
  notifier: Notifier
): HookHandler<Hooks.OrderRejected> => {
  return async (args: HookParams<Hooks.OrderRejected>) => {
    const arg = args as OrderRejectedParams;
    const logger = arg.context.logger.child({
      hook: "hookHandlerOrderRejected",
    });
    const reason = RejectionReason[arg.reason];
    const message = `Order #${arg.order.orderId} has been rejected, reason: ${reason}`;
    await notifier.notify(message, { logger });
  };
};
