import { ChainId, OrderData } from "@debridge-finance/pmm-client";
import { Logger } from "pino";

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
  type: "created" | "fulfilled" | "other";
  order: OrderData | null;
  taker?: string;
};

export abstract class GetNextOrder {
  protected enabledChains: ChainId[];
  protected logger: Logger;

  abstract init(): void;

  abstract getNextOrder(): Promise<NextOrderInfo | undefined>;

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
