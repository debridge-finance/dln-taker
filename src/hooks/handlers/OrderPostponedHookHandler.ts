import { HookHandler } from "../HookHandler";
import {Notifier} from "../notification/Notifier";
import {Hooks, PostponingReason} from "../HookEnums";
import {HookParams} from "../types/HookParams";
import Web3 from "web3";
import {ChainId, tokenAddressToString} from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";

export const orderPostponed = (
    notifier: Notifier,
): HookHandler<Hooks.OrderPostponed> => {
    return async (arg: HookParams<Hooks.OrderPostponed>) => {
        const handlerName = "orderPostponed";
        const logger = arg.context.logger.child({
            handlerName,
        });
        if (arg.attempts > 1) {
            return;
        }
        const order = arg.order.order;
        const [giveDecimals, takeDecimals, giveTokenSymbol, takeTokenSymbol] = await Promise.all([
            arg.context.config.client.getDecimals(order.give.chainId, order.give.tokenAddress, arg.context.giveChain.fulfillProvider.connection as Web3),
            arg.context.config.client.getDecimals(order.take.chainId, order.take.tokenAddress, arg.context.config.chains[order.take.chainId]?.fulfillProvider.connection as Web3),
            arg.context.config.client.getTokenSymbol(order.give.chainId, order.give.tokenAddress, arg.context.giveChain.fulfillProvider.connection as Web3),
            arg.context.config.client.getTokenSymbol(order.take.chainId, order.take.tokenAddress, arg.context.config.chains[order.take.chainId]?.fulfillProvider.connection as Web3),
        ]);
        const giveInfo = `${new BigNumber(order.give.amount.toString()).div(new BigNumber(10).pow(giveDecimals))} ${giveTokenSymbol} @ ${ChainId[order.give.chainId]}`;
        const takeInfo = `${new BigNumber(order.take.amount.toString()).div(new BigNumber(10).pow(takeDecimals))} ${takeTokenSymbol} @ ${ChainId[order.take.chainId]}`;
        const attempts = arg.attempts > 0 ? ` (attempt: ${arg.attempts + 1})` : ''
        const message = `Order #<a href="https://dln.debridge.finance/order?orderId=${arg.order.orderId}">${arg.order.orderId}</a>${attempts} (${giveInfo} -> ${takeInfo}) has been postponed because of ${PostponingReason[arg.reason]}: ${arg.message}`;
        await notifier.notify(message, { logger });
    };
};