import { HookHandler } from "../HookHandler";
import {Notifier} from "../notification/Notifier";
import {Hooks, PostponingReason} from "../HookEnums";
import {HookParams} from "../types/HookParams";

export const orderPostponed = (
    notifier: Notifier,
): HookHandler<Hooks.OrderPostponed> => {
    return async (arg: HookParams<Hooks.OrderPostponed>) => {
        const handlerName = "orderPostponed";
        const logger = arg.context.logger.child({
            handlerName,
        });
        const message = `Order #${arg.order.orderId} has been postponed because of ${PostponingReason[arg.reason]}: ${arg.message}`;
        await notifier.notify(message, { logger });
    };
};