import { ChainId } from "@debridge-finance/dln-client";

import { IncomingOrder } from "../interfaces";
import { OrderProcessorContext } from "../processors/base";
import { Hook, OrderPostponedHookReason, OrderRejectedHookReason } from "./HookEnums";

export type OrderEstimation = {
  isProfitable: boolean; // CalculateResult.isProfitable
  reserveToken: Uint8Array; // CalculateResult.reserveDstToken
  requiredReserveAmount: string; // CalculateResult.requiredReserveDstAmount
  fulfillToken: Uint8Array; // order.take.tokenAddress
  projectedFulfillAmount: string; // CalculateResult.profitableTakeAmount
};

export type HookParams<T extends Hook> =
  {} & (T extends Hook.OrderFeedConnected
    ? {
        timeSinceLastDisconnect?: number;
      }
    : {}) &
    (T extends Hook.OrderFulfilled
      ? {
          order: IncomingOrder<any>;
          txHash: string;
        }
      : {}) &
    (T extends Hook.OrderPostponed
      ? {
          order: IncomingOrder<any>;
          reason: OrderPostponedHookReason;
          message?: string;
          estimation?: OrderEstimation;
          context: OrderProcessorContext;
        }
      : {}) &
    (T extends Hook.OrderUnlockFailed
      ? {
          orderIds: string[];
          fromChainId: ChainId;
          toChainId: ChainId;
          reason: "FAILED" | "REVERTED";
          message: string;
        }
      : {}) &
    (T extends Hook.OrderUnlockSent
      ? {
          orderIds: string[];
          fromChainId: ChainId;
          toChainId: ChainId;
          txHash: string;
        }
      : {}) &
    (T extends Hook.OrderRejected
      ? {
          order: IncomingOrder<any>;
          reason: OrderRejectedHookReason;
          context: OrderProcessorContext;
        }
      : {}) &
    (T extends Hook.OrderEstimated
      ? {
          order: IncomingOrder<any>;
          estimation: OrderEstimation;
          context: OrderProcessorContext;
        }
      : {});
