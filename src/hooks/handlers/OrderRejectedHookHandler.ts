import {HookHandler} from "../HookHandler";
import {Notifier} from "../notification/Notifier";
import {Hooks, RejectionReason} from "../HookEnums";
import {HookParams} from "../types/HookParams";
import {ChainId} from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";
import {OrderInfoStatus} from "../../interfaces";

export const orderRejected = (
    notifier: Notifier
): HookHandler<Hooks.OrderRejected> => {
    return async (arg: HookParams<Hooks.OrderRejected>) => {
        const handlerName = "orderRejected";
        const logger = arg.context.logger.child({
            handlerName,
        });

        // notify about live orders only
        if (arg.order.status !== OrderInfoStatus.Created) {
            return;
        }

        // show only one attempt
        if (arg.attempts > 0) {
            return;
        }

        if ([RejectionReason.ALREADY_FULFILLED_OR_CANCELLED, RejectionReason.NOT_ENOUGH_BLOCK_CONFIRMATIONS_FOR_ORDER_WORTH].includes(arg.reason)) {
            return;
        }

        const order = arg.order.order;
        const [giveDecimals, takeDecimals, { symbol: giveTokenSymbol }, { symbol: takeTokenSymbol }] = await Promise.all([
            arg.context.config.client.getDecimals(order.give.chainId, order.give.tokenAddress),
            arg.context.config.client.getDecimals(order.take.chainId, order.take.tokenAddress),
            arg.context.config.client.getTokenInfo(order.give.chainId, order.give.tokenAddress),
            arg.context.config.client.getTokenInfo(order.take.chainId, order.take.tokenAddress),
        ]);
        const giveInfo = `${new BigNumber(order.give.amount.toString()).div(new BigNumber(10).pow(giveDecimals)).toFixed(3)} ${giveTokenSymbol} @ ${ChainId[order.give.chainId]}`;
        const takeInfo = `${new BigNumber(order.take.amount.toString()).div(new BigNumber(10).pow(takeDecimals)).toFixed(3)} ${takeTokenSymbol} @ ${ChainId[order.take.chainId]}`;
        const message = `🤑 Order #<a href="https://app.debridge.finance/order?orderId=${arg.order.orderId}">${arg.order.orderId}</a>
${giveInfo} ➡️ ${takeInfo}

⛔️ rejected because: ${RejectionReason[arg.reason]}

${arg.message}`;
        await notifier.notify(message, { logger });
    };
};