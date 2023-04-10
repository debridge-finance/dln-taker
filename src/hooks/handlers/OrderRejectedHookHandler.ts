import { HookHandler } from "../HookHandler";
import {Notifier} from "../notification/Notifier";
import {Hooks, RejectionReason} from "../HookEnums";
import {HookParams} from "../types/HookParams";

export const orderRejected = (
    notifier: Notifier
): HookHandler<Hooks.OrderRejected> => {
    return async (arg: HookParams<Hooks.OrderRejected>) => {
        const handlerName = "orderRejected";
        const logger = arg.context.logger.child({
            handlerName,
        });
        const message = `Order #${arg.order.orderId} has been rejected because of ${ RejectionReason[arg.reason] }: ${ arg.message }`
        await notifier.notify(message, { logger });
    };
};