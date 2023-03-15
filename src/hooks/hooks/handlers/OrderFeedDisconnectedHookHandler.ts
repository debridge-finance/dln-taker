import { Hooks } from "../../Hooks";
import { Notifier } from "../../notification/Notifier";
import { HookParams } from "../../types/HookParams";
import { HookContext, HookHandler } from "../HookHandler";

export const orderFeedDisconnected = (
  notifier: Notifier
): HookHandler<Hooks.OrderFeedDisconnected> => {
  return async (
    args: HookParams<Hooks.OrderFeedDisconnected>,
    context?: HookContext
  ) => {
    const handlerName = "orderFeedDisconnected";
    const logger = context!.logger.child({
      handlerName,
    });
    const message = `Websocket connection is lost!`;
    await notifier.notify(message, { logger });
  };
};
