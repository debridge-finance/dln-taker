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
        const message = `${args.orderIds.length} orders were send for unlock from ${ChainId[args.fromChainId]} to ${ChainId[args.toChainId]}}, txhash: ${args.txHash}`;
        await notifier.notify(message, { logger });
    };
};