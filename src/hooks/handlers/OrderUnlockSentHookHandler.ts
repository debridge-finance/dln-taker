import { HookContext, HookHandler } from "../HookHandler";
import {Notifier} from "../notification/Notifier";
import {Hooks} from "../HookEnums";
import {HookParams} from "../types/HookParams";
import {ChainId} from "@debridge-finance/dln-client";

export const orderUnlockSent = (
    notifier: Notifier
): HookHandler<Hooks.OrderUnlockSent> => {
    return async (
        args: HookParams<Hooks.OrderUnlockSent>,
        context?: HookContext
    ) => {
        const handlerName = "orderUnlockSent";
        const logger = context!.logger.child({
            handlerName,
        });
        const message = `🔓 ${args.orderIds.length} orders were sent for unlock from ${ChainId[args.fromChainId]} to ${ChainId[args.toChainId]}, txhash: ${args.txHash}.

Orders: ${args.orderIds.join(', ')}`;
        await notifier.notify(message, { logger });
    };
};