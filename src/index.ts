import { Order, OrderData, Solana } from "@debridge-finance/pmm-client";
import { GetNextOrder, GetProfit, PriceFeed } from "./interfaces";
import { Connection, Keypair, Transaction } from "@solana/web3.js";

class CalimerApi implements PriceFeed {
	async getUsdPrice(chainId: bigint, tokenAddress: string): Promise<bigint> {
		const multiplier = 100;
		const query = `https://claimerapi.debridge.io/TokenPrice/usd_price?chainId=${chainId}&tokenAddress=0x${tokenAddress}`;
		const response = await fetch(query);
		if (response.status === 200) {
			return BigInt(multiplier * Number(await response.text()));
		} else {
			const parsedJson = (await response.json()) as { message: string };
			throw new Error(parsedJson.message);
		}
	}
}

class ProfitChecker implements GetProfit {
	private feeMap = {
		1: 1234n,
	};

	async getProfit(dstChainId: bigint, giveUsdAmount: bigint, takeUsdAmount: bigint): Promise<bigint> {
		const delta = giveUsdAmount - takeUsdAmount;
		if (Object.keys(this.feeMap).includes(dstChainId.toString())) {
			return delta - this.feeMap[dstChainId.toString()];
		}
		return delta;
	}
}

const feed = new CalimerApi();
const checker = new ProfitChecker();

type EmptyTuple = [];
type Head<T extends unknown[]> = T extends [...infer U, unknown] ? U : unknown[];
type OmitLastParam<F> = F extends (...args: infer P) => infer Ret
	? Head<P> extends EmptyTuple
		? () => Ret
		: (...args: Head<P>) => Ret
	: never;

function wrapIntoAbortController<T extends (...args: any[]) => any>(fn: T, ...args: Parameters<OmitLastParam<T>>) {
	const controller = new AbortController();
	const { signal } = controller;
	fn(...args, signal);
	return controller;
}

async function sleep(milliSeconds: number) {
	return new Promise<void>((resolve, reject) => {
		setTimeout(resolve, milliSeconds);
	});
}

async function orderProcessor(
	connection: Connection,
	dstClient: Solana.PMMDst,
	taker: Keypair,
	beneficiary: Buffer,
	order: OrderData,
	priceFeed: PriceFeed,
	profitChecker: GetProfit,
	expectedProfit: bigint,
	signal: AbortSignal,
): Promise<bigint | undefined> {
	if (signal.aborted) return undefined;

	const givePrice = await priceFeed.getUsdPrice(order.give.chainId, `0x${order.give.tokenAddress.toString("hex")}`);
	if (signal.aborted) return undefined;
	const takePrice = await priceFeed.getUsdPrice(order.take.chainId, `0x${order.take.tokenAddress.toString("hex")}`);
	if (signal.aborted) return undefined;
	const giveUsdAmonut = givePrice * order.give.amount;
	const takeUsdAmount = takePrice * order.take.amount;

	const profit = await profitChecker.getProfit(order.take.chainId, giveUsdAmonut, takeUsdAmount);
	if (signal.aborted) return undefined;

	if (profit < expectedProfit) return undefined;
	const fulfillIx = await dstClient.fulfillOrder(taker.publicKey, order);
	if (signal.aborted) return undefined;

	await connection.sendTransaction(new Transaction().add(fulfillIx), [taker]);
	if (signal.aborted) return undefined;

	const orderId = Buffer.from(Order.calculateId(order).slice(2), "hex");
	const [orderState] = await dstClient.getTakeOrderStateAddress(orderId);
	let stateExists = false;
	while (!stateExists) {
		if (signal.aborted) return undefined;
		const data = await connection.getAccountInfo(orderState);
		if (data !== null && data.owner.equals(dstClient.program.programId)) stateExists = true;
		if (signal.aborted) return undefined;
		await sleep(3000);
	}
	// TODO calc execution fee
	const unlockIx = await dstClient.sendUnlock(taker.publicKey, order, beneficiary, 0n);
	if (signal.aborted) return undefined;
	await connection.sendTransaction(new Transaction().add(unlockIx), [taker]);
}

async function main() {
	const taskMap = new Map<string, ReturnType<typeof wrapIntoAbortController>>();
	const orderBroker: GetNextOrder = { getNextOrder: () => new Promise((resolve, reject) => resolve({} as OrderData)) };
	const expectedProfit = 123n; // TODO: move to env
	const connection = new Connection(""); // TODO: get connection endpoint from env
	const dstClient = new Solana.PMMDst("", "", "", connection); // TODO: get pmm dst/debridge/debridge settings addresses from env
	const taker: Keypair = new Keypair(); // TODO: get taker wallet from env
	const beneficiary = Buffer.from(Array.from({ length: 20 }).fill(0) as number[]);

	let previousOrderId: string | null = null;
	while (true) {
		const order = await orderBroker.getNextOrder();
		if (order === null) {
			if (previousOrderId !== null) {
				const task = taskMap.get(previousOrderId);
				task?.abort();
			}
		} else {
			previousOrderId = Order.calculateId(order);
			taskMap.set(
				previousOrderId,
				wrapIntoAbortController(orderProcessor, connection, dstClient, taker, beneficiary, order, feed, checker, expectedProfit),
			);
		}
	}
}
