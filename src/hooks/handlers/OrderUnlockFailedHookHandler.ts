import { HookContext, HookHandler } from "../HookHandler";
import { Hooks } from "../HookEnums";
import { Notifier } from "../notification/Notifier";
import { HookParams } from "../types/HookParams";
import {ChainId} from "@debridge-finance/dln-client";

export const orderUnlockFailed = (
    notifier: Notifier
): HookHandler<Hooks.OrderUnlockFailed> => {
    return async (
        arg: HookParams<Hooks.OrderUnlockFailed>,
        context?: HookContext
    ) => {
        const handlerName = "orderUnlockFailed";
        const logger = context!.logger.child({
            handlerName,
        });
        const message = `${arg.orderIds.length} orders were failed to be unlocked from ${ChainId[arg.fromChainId]} to ${ChainId[arg.toChainId]}: ${arg.message}`;
        await notifier.notify(message, { logger });
    };
};