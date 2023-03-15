import { Database } from "../../database/Database";
import { PostponingReason } from "../../HookEnums";
import { Hooks } from "../../Hooks";
import { Notifier } from "../../notification/Notifier";
import { HookParams } from "../../types/HookParams";
import { HookHandler } from "../HookHandler";

export const orderPostponed = (
  notifier: Notifier,
  database: Database
): HookHandler<Hooks.OrderPostponed> => {
  return async (arg: HookParams<Hooks.OrderPostponed>) => {
    const handlerName = "orderPostponed";
    const logger = arg.context.logger.child({
      handlerName,
    });
    await database.init();

    const isProcessed = await database.check(
      arg.order.orderId,
      handlerName
    );
    if (isProcessed) {
      logger.warn(`Order was processed`);
      return;
    }

    if (arg.reason === PostponingReason.NON_PROFITABLE) {
      return;
    }

    const reason = PostponingReason[arg.reason];
    const message = `Order #${arg.order.orderId} has been postponed, reason: ${reason} message: ${arg.message}`;
    await notifier.notify(message, { logger });
    await database.save(arg.order.orderId, handlerName);
  };
};
