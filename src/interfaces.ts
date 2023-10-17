import { ChainId, OrderData } from '@debridge-finance/dln-client';
import { Logger } from 'pino';

import { HooksEngine } from './hooks/HooksEngine';
import { ExecutorSupportedChain, IExecutor } from './executor';

export enum OrderInfoStatus {
  Created,
  ArchivalCreated,
  ArchivalFulfilled,
  Fulfilled,
  Cancelled,
  UnlockSent,
  UnlockClaim,
  TakeOfferDecreased,
  GiveOfferIncreased,
}

export type OrderId = string;

type FinalizationInfo =
  | {
      Finalized: {
        transaction_hash: string;
      };
    }
  | {
      Confirmed: {
        confirmation_blocks_count: number;
        transaction_hash: string;
      };
    }
  | 'Revoked';

export type IncomingOrder<T extends OrderInfoStatus> = {
  orderId: string;
  status: OrderInfoStatus;
  order: OrderData;
} & (T extends OrderInfoStatus.ArchivalFulfilled ? { unlockAuthority: string } : {}) &
  (T extends OrderInfoStatus.Fulfilled ? { unlockAuthority: string } : {}) &
  (T extends OrderInfoStatus.Created ? { finalization_info: FinalizationInfo } : {});

export type IncomingOrderContext = {
  orderInfo: IncomingOrder<OrderInfoStatus>;
  giveChain: ExecutorSupportedChain;
  takeChain: ExecutorSupportedChain;
};

export type OrderProcessorFunc = (order: IncomingOrder<any>) => Promise<void>;

export type UnlockAuthority = {
  chainId: ChainId;
  address: string;
};

export interface Authority {
  address: string;
  bytesAddress: Uint8Array;
  avgBlockSpeed: number;
  finalizedBlockCount: number;
}

export abstract class GetNextOrder {
  // @ts-ignore Initialized deferredly within the setEnabledChains() method. Should be rewritten during the next major refactoring
  protected enabledChains: ChainId[];

  // @ts-ignore Initialized deferredly within the setLogger() method. Should be rewritten during the next major refactoring
  protected logger: Logger;

  // @ts-ignore Initialized deferredly within the init() method. Should be rewritten during the next major refactoring
  protected processNextOrder: OrderProcessorFunc;

  abstract init(
    processNextOrder: OrderProcessorFunc,
    UnlockAuthority: UnlockAuthority[],
    minConfirmationThresholds: Array<{
      chainId: ChainId;
      points: number[];
    }>,
    hooksEngine: HooksEngine,
  ): void;

  setEnabledChains(enabledChains: ChainId[]) {
    this.enabledChains = enabledChains;
  }

  setLogger(logger: Logger) {
    this.logger = logger.child({ service: GetNextOrder.name });
  }
}
