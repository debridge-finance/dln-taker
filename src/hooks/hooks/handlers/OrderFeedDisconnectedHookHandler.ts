import { Hooks } from "../../Hooks";
import { Notifier } from "../../notification/Notifier";
import { HookParams } from "../../types/params/HookParams";
import { HookContext, HookHandler } from "../HookHandler";

export const orderFeedDisconnected = (
  notifier: Notifier
): HookHandler<Hooks.OrderFeedDisconnected> => {
  return async (
    args: HookParams<Hooks.OrderFeedDisconnected>,
    context?: HookContext
  ) => {
    const logger = context!.logger.child({
      hook: "hookHandlerOrderFeedDisconnected",
    });
    const message = `Websocket connection is lost!`;
    await notifier.notify(message, { logger });
  };
};
