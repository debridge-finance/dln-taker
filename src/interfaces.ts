import { ChainId, OrderData } from "@debridge-finance/dln-client";
import { Logger } from "pino";

import { OrderInfoStatus } from "./enums/order.info.status";
import { OrderProcessorContext } from "./processors/order.processor";

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

export type NextOrderInfo = {
  orderId: string;
  type: OrderInfoStatus;
  order: OrderData | null;
  taker?: string;
};

export type ProcessOrder = (params: ProcessorParams) => Promise<void>;

export type ProcessorParams = {
  orderInfo: NextOrderInfo;
  context: OrderProcessorContext;
};

export type ExecuteNextOrder = (order?: NextOrderInfo) => Promise<void>;

export abstract class GetNextOrder {
  protected enabledChains: ChainId[];
  protected logger: Logger;
  protected processNextOrder: ExecuteNextOrder;

  constructor() {}

  abstract init(processNextOrder: ExecuteNextOrder): void;

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
