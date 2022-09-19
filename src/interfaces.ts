import { OrderData } from "@debridge-finance/pmm-client";

export interface PriceFeed {
	getUsdPrice(chainId: bigint, tokenAddress: string): Promise<bigint>;
}

export interface GetNextOrder {
	getNextOrder(): Promise<OrderData | null>;
}

export interface GetProfit {
	getProfit(dstChainId: bigint, giveUsdAmount: bigint, takeUsdAmount: bigint): Promise<bigint>;
}
