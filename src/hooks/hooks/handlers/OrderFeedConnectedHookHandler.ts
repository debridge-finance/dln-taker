import { Hooks } from "../../Hooks";
import { Notifier } from "../../notification/Notifier";
import { HookParams } from "../../types/HookParams";
import { HookContext, HookHandler } from "../HookHandler";

export const orderFeedConnected = (
  notifier: Notifier
): HookHandler<Hooks.OrderFeedConnected> => {
  return async (
    arg: HookParams<Hooks.OrderFeedConnected>,
    context?: HookContext
  ) => {
    const handlerName = "orderFeedConnected";
    const logger = context!.logger.child({
      handlerName,
    });
    let message = `Websocket connected`;
    if (arg.timeSinceLastDisconnect) {
      message = `Websocket connected after ${arg.timeSinceLastDisconnect} seconds`;
    }
    await notifier.notify(message, { logger });
  };
};
