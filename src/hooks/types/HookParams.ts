import { ChainId } from "@debridge-finance/dln-client";

import { IncomingOrder } from "../../interfaces";
import { OrderProcessorContext } from "../../processors/base";
import { Hooks, PostponingReason, RejectionReason } from "../HookEnums";

import { OrderEstimation } from "./OrderEstimation";

export type HookParams<T extends Hooks> =
    {} & (T extends Hooks.OrderFeedConnected
    ? {
        message: string;
    }
    : {}) &
    (T extends Hooks.OrderFeedDisconnected
        ? {
            message: string;
        }
        : {}) &
    (T extends Hooks.OrderFulfilled
        ? {
            order: IncomingOrder<any>;
            txHash: string;
        }
        : {}) &
    (T extends Hooks.OrderPostponed
        ? {
            order: IncomingOrder<any>;
            reason: PostponingReason;
            message: string;
            attempts: number;
            context: OrderProcessorContext;
        }
        : {}) &
    (T extends Hooks.OrderUnlockFailed
        ? {
            orderIds: string[];
            fromChainId: ChainId;
            toChainId: ChainId;
            message: string;
        }
        : {}) &
    (T extends Hooks.OrderUnlockSent
        ? {
            orderIds: string[];
            fromChainId: ChainId;
            toChainId: ChainId;
            txHash: string;
        }
        : {}) &
    (T extends Hooks.OrderRejected
        ? {
            order: IncomingOrder<any>;
            reason: RejectionReason;
            message: string;
            attempts: number;
            context: OrderProcessorContext;
        }
        : {}) &
    (T extends Hooks.OrderEstimated
        ? {
            order: IncomingOrder<any>;
            estimation: OrderEstimation;
            context: OrderProcessorContext;
        }
        : {});