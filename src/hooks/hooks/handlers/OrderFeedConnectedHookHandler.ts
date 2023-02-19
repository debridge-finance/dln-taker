import { Hooks } from "../../Hooks";
import { Notifier } from "../../notification/Notifier";
import { TelegramNotifier } from "../../notification/TelegramNotifier";
import { HookParams } from "../../types/params/HookParams";
import { OrderFeedConnectedParams } from "../../types/params/OrderFeedConnectedParams";
import { HookContext, HookHandler } from "../HookHandler";

export const orderFeedConnected = (
  notifier: Notifier
): HookHandler<Hooks.OrderFeedConnected> => {
  return async (
    args: HookParams<Hooks.OrderFeedConnected>,
    context?: HookContext
  ) => {
    const arg = args as OrderFeedConnectedParams;
    const logger = context!.logger.child({
      hook: "hookHandlerOrderFeedConnected",
    });
    let message = `Websocket connected`;
    if (arg.timeSinceLastDisconnect) {
      message = `Websocket connected after ${arg.timeSinceLastDisconnect} seconds`;
    }
    await notifier.notify(message, { logger });
  };
};
