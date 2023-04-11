import { HookHandler } from "../HookHandler";
import {Notifier} from "../notification/Notifier";
import {Hooks, PostponingReason} from "../HookEnums";
import {HookParams} from "../types/HookParams";
import Web3 from "web3";
import {tokenAddressToString} from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";

export const orderPostponed = (
    notifier: Notifier,
): HookHandler<Hooks.OrderPostponed> => {
    return async (arg: HookParams<Hooks.OrderPostponed>) => {
        const handlerName = "orderPostponed";
        const logger = arg.context.logger.child({
            handlerName,
        });
        if (arg.attempts > 5) {
            return;
        }
        const order = arg.order.order;
        const [giveDecimals, takeDecimals] = await Promise.all([
            arg.context.config.client.getDecimals(order.give.chainId, order.give.tokenAddress, arg.context.giveChain.fulfillProvider.connection as Web3),
            arg.context.config.client.getDecimals(order.take.chainId, order.take.tokenAddress, arg.context.config.chains[order.take.chainId]?.fulfillProvider.connection as Web3),
        ]);
        const giveInfo = `giveInfo(chainId=${order.give.chainId}, tokenAddress=${tokenAddressToString(order.give.chainId, order.give.tokenAddress)}, amount=${new BigNumber(order.give.amount.toString()).div(new BigNumber(10).pow(giveDecimals))})`;
        const takeInfo = `takeInfo(chainId=${order.take.chainId}, tokenAddress=${tokenAddressToString(order.take.chainId, order.take.tokenAddress)}, amount=${new BigNumber(order.take.amount.toString()).div(new BigNumber(10).pow(takeDecimals))})`;
        const message = `Order #<a href="https://dln.debridge.finance/order?orderId=${arg.order.orderId}">${arg.order.orderId}</a>(attempt: ${arg.attempts})(${giveInfo} ${takeInfo}) has been postponed because of ${PostponingReason[arg.reason]}: ${arg.message}`;
        await notifier.notify(message, { logger });
    };
};