import { ChainId, OrderData } from '@debridge-finance/dln-client';
import { IExecutor } from '../../executor';
import { Hooks, PostponingReason, RejectionReason } from '../HookEnums';

export type HookParams<T extends Hooks> = {} & (T extends Hooks.OrderFeedConnected
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
        orderId: string;
        order: OrderData;
        txHash: string;
      }
    : {}) &
  (T extends Hooks.OrderPostponed
    ? {
        orderId: string;
        order: OrderData;
        isLive: boolean;
        reason: PostponingReason;
        message: string;
        attempts: number;
        executor: IExecutor;
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
        orderId: string;
        order: OrderData;
        isLive: boolean;
        reason: RejectionReason;
        message: string;
        attempts: number;
        executor: IExecutor;
      }
    : {});
