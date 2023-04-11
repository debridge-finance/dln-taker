import { HookHandler } from "../HookHandler";
import {Notifier} from "../notification/Notifier";
import {Hooks, RejectionReason} from "../HookEnums";
import {HookParams} from "../types/HookParams";
import {ChainId, tokenAddressToString} from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";
import Web3 from "web3";

export const orderRejected = (
    notifier: Notifier
): HookHandler<Hooks.OrderRejected> => {
    return async (arg: HookParams<Hooks.OrderRejected>) => {
        const handlerName = "orderRejected";
        const logger = arg.context.logger.child({
            handlerName,
        });
        if (arg.attempts > 5) {
            return;
        }
        const order = arg.order.order;
        const [giveDecimals, takeDecimals, giveTokenSymbol, takeTokenSymbol] = await Promise.all([
            arg.context.config.client.getDecimals(order.give.chainId, order.give.tokenAddress, arg.context.giveChain.fulfillProvider.connection as Web3),
            arg.context.config.client.getDecimals(order.take.chainId, order.take.tokenAddress, arg.context.config.chains[order.take.chainId]?.fulfillProvider.connection as Web3),
            arg.context.config.client.getTokenSymbol(order.give.chainId, order.give.tokenAddress, arg.context.giveChain.fulfillProvider.connection as Web3),
            arg.context.config.client.getTokenSymbol(order.take.chainId, order.take.tokenAddress, arg.context.config.chains[order.take.chainId]?.fulfillProvider.connection as Web3),
        ]);
        const giveInfo = `${new BigNumber(order.give.amount.toString()).div(new BigNumber(10).pow(giveDecimals))} ${giveTokenSymbol}@${ChainId[order.give.chainId]}`;
        const takeInfo = `${new BigNumber(order.take.amount.toString()).div(new BigNumber(10).pow(takeDecimals))} ${takeTokenSymbol}@${ChainId[order.take.chainId]}`;
        const message = `Order #<a href="https://dln.debridge.finance/order?orderId=${arg.order.orderId}">${arg.order.orderId}</a>(attempt: ${arg.attempts})(${giveInfo} -> ${takeInfo}) has been rejected because of ${ RejectionReason[arg.reason] }: ${ arg.message }`
        await notifier.notify(message, { logger });
    };
};