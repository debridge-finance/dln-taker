import { OrderData, ChainId } from "@debridge-finance/pmm-client";

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
	EXPECTED_PROFIT: bigint;
	RABBIT_URL: string;
	QUEUE_NAME: string;
	CREATED_EVENT_TIMEOUT: number;
};

export interface PriceFeed {
	getUsdPrice(chainId: ChainId, tokenAddress: string): Promise<bigint>;
}

export type NextOrderInfo = {
	orderId: string;
	type: "created" | "fulfilled" | "other";
	order: OrderData | null,
	taker?: string;
}

export interface GetNextOrder {
	getNextOrder(): Promise<NextOrderInfo>;
}

export interface GetProfit {
	getProfit(dstChainId: ChainId, giveUsdAmount: bigint, takeUsdAmount: bigint): Promise<bigint>;
}

export type ProviderAdapter = {
	connection: unknown;
	wallet: unknown;
	address: string;
	sendTransaction: (data: unknown) => Promise<unknown>;
};

export type AdapterContainer = {
	[chainId: number]: ProviderAdapter;
};
