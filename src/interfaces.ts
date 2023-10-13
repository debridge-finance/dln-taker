import { ChainId, CommonDlnClient, Evm, OrderData, Solana } from '@debridge-finance/dln-client';
import { Logger } from 'pino';

import { OrderProcessorContext } from './processors/base';
import { HooksEngine } from './hooks/HooksEngine';

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
  context: OrderProcessorContext;
};

export type OrderProcessorFunc = (order: IncomingOrder<any>) => Promise<void>;

export type UnlockAuthority = {
  chainId: ChainId;
  address: string;
};

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
    this.logger = logger;
  }
}

type ActiveClients = Solana.DlnClient | Evm.DlnClient;
export type DlnClient = CommonDlnClient<ActiveClients>;
