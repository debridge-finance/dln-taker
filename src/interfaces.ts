import { ChainId, OrderData } from "@debridge-finance/dln-client";
import { Logger } from "pino";

import { OrderInfoStatus } from "./enums/order.info.status";
import { OrderProcessorContext } from "./processors/base";

export type ChainConfig = {
  PMM_SRC: string;
  PMM_DST: string;
  DEBRIDGE: string;
  DEBRIDGE_SETTINGS?: string;
  WALLET: string;
  RPC_URL: string;
  BENEFICIARY: string;
};

export type Config = {
  [chain: number]: ChainConfig;
  EXPECTED_PROFIT: number;
  // RABBIT_URL: string;
  // QUEUE_NAME: string;
  WS_URL: string;
  CREATED_EVENT_TIMEOUT: number;
};

export type IncomingOrder = {
  orderId: string;
  type: OrderInfoStatus;
  order: OrderData | null;
  taker?: string;
};

export type ProcessOrder = (params: IncomingOrderContext) => Promise<void>;

export type IncomingOrderContext = {
  orderInfo: IncomingOrder;
  context: OrderProcessorContext;
};

export type OrderProcessorFunc = (order?: IncomingOrder) => Promise<void>;

export abstract class GetNextOrder {
  protected enabledChains: ChainId[];
  protected logger: Logger;
  protected processNextOrder: OrderProcessorFunc;

  constructor() {}

  abstract init(processNextOrder: OrderProcessorFunc): void;

  setEnabledChains(enabledChains: ChainId[]) {
    this.enabledChains = enabledChains;
  }

  setLogger(logger: Logger) {
    this.logger = logger;
  }
}

export interface GetProfit {
  getProfit(
    dstChainId: ChainId,
    giveUsdAmount: bigint,
    takeUsdAmount: bigint
  ): Promise<bigint>;
}
