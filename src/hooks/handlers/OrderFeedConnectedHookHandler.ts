import { HookContext, HookHandler } from "../HookHandler";
import { Hooks } from "../HookEnums";
import { Notifier } from "../notification/Notifier";
import { HookParams } from "../types/HookParams";

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
        await notifier.notify(arg.message, { logger });
    };
};