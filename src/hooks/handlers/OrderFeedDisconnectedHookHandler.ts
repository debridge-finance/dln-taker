import { HookContext, HookHandler } from "../HookHandler";
import {Notifier} from "../notification/Notifier";
import {Hooks} from "../HookEnums";
import {HookParams} from "../types/HookParams";

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
        const message = `⚠️ Websocket disconnected!`;
        await notifier.notify(message, { logger });
    };
};