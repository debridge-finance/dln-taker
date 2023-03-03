import { ChainId, OrderData } from "@debridge-finance/dln-client";
import { Logger } from "pino";

import { OrderProcessorContext } from "./processors/base";

export enum OrderInfoStatus {
  Created,
  ArchivalCreated,
  ArchivalFulfilled,
  Fulfilled,
  Cancelled,
  UnlockSent,
  UnlockClaim,
  TakeOfferDecreased,
  GiveOfferIncreased
}

type FinalizationInfo = {
  Finalized: {
    transaction_hash:  string;
  }
} | {
  Confirmed: {
    confirmation_blocks_count: number;
    transaction_hash:  string;
  }
} | "Revoked";

export type IncomingOrder<T extends OrderInfoStatus> = {
  orderId: string;
  status: OrderInfoStatus;
  order: OrderData;
} & (T extends OrderInfoStatus.ArchivalFulfilled ? { unlockAuthority: string } : {}
) & (T extends OrderInfoStatus.Fulfilled ? { unlockAuthority: string } : {}
) & (T extends OrderInfoStatus.Created ? { finalization_info: FinalizationInfo } : {})

export type ProcessOrder = (params: IncomingOrderContext) => Promise<void>;

export type IncomingOrderContext = {
  orderInfo: IncomingOrder<OrderInfoStatus>;
  context: OrderProcessorContext;
  attempts: number;
};

export type OrderProcessorFunc = (order: IncomingOrder<any>) => Promise<void>;

export type UnlockAuthority = {
  chainId: ChainId;
  address: string;
};

export abstract class GetNextOrder {
  protected enabledChains: ChainId[];
  protected logger: Logger;
  protected processNextOrder: OrderProcessorFunc;

  constructor() {}

  abstract init(
    processNextOrder: OrderProcessorFunc,
    UnlockAuthority: UnlockAuthority[],
    minConfirmationThresholds: Array<{
      chainId: ChainId;
      points: number[]
    }>
  ): void;

  setEnabledChains(enabledChains: ChainId[]) {
    this.enabledChains = enabledChains;
  }

  setLogger(logger: Logger) {
    this.logger = logger;
  }
}