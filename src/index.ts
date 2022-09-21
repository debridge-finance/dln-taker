import { Order, OrderData, Solana } from "@debridge-finance/pmm-client";
import { GetNextOrder, GetProfit, PriceFeed } from "./interfaces";
import { Connection, Keypair, Transaction, PublicKey, TransactionInstruction, SYSVAR_RENT_PUBKEY, SystemProgram } from "@solana/web3.js";
import client, { Connection as MQConnection } from "amqplib";
import { PmmEvent } from "./pmm_common";
import { eventToOrderData } from "./helpers";
import bs58 from "bs58";
import { ASSOCIATED_TOKEN_PROGRAM_ID, findAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@debridge-finance/solana-utils";

class CalimerApi implements PriceFeed {
	async getUsdPrice(chainId: bigint, tokenAddress: string): Promise<bigint> {
		console.log(`Getting price of token: ${tokenAddress}, chain: ${chainId}`);
		const multiplier = 1e4;
		const query = `https://claimerapi.debridge.io/TokenPrice/usd_price?chainId=${chainId}&tokenAddress=0x${tokenAddress}`;
		// @ts-expect-error
		const response = await fetch(query);
		if (response.status === 200) {
			return BigInt(Math.floor(multiplier * Number(await response.text())));
		} else {
			const parsedJson = (await response.json()) as { message: string };
			throw new Error(parsedJson.message);
		}
	}
}

class ProfitChecker implements GetProfit {
	private feeMap: Record<string, bigint> = {
		"1": 1234n,
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

class NextOrder implements GetNextOrder {
	private queue: client.ConsumeMessage[] = [];
	private mqConnection: MQConnection;

	constructor(public initialized: boolean = false) {}

	async init(queueName: string) {
		this.mqConnection = await client.connect("amqp://127.0.0.1:5672");
		const channel = await this.mqConnection.createChannel();
		await channel.assertQueue(queueName, { durable: false });
		channel.consume(queueName, (msg) => {
			if (msg) {
				this.queue.push(msg);
			}
		});
		this.initialized = true;
	}

	async getNextOrder(): Promise<OrderData | null> {
		if (!this.initialized) await this.init("PmmDevnetEvents");
		while (true) {
			if (this.queue.length != 0) {
				const firstIn = this.queue.shift();
				const decoded = PmmEvent.fromBinary(firstIn!.content);
				if (decoded.event.oneofKind === "createdSrc") {
					if (decoded.event.createdSrc.createdOrder?.externalCall !== undefined) return null;
					const orderData = eventToOrderData(decoded.event.createdSrc.createdOrder!);
					console.log(decoded.event.createdSrc.createdOrder);
					if (orderData.take.chainId === 1n && orderData.take.tokenAddress.equals(Buffer.from(Array.from({length: 20}).fill(0) as number[]))) return null;
					
					// if (blacklist.includes(decoded.event.createdSrc.createdOrder!.makerOrderNonce )) return null;
					return orderData;
				}
				return null;
			}
			await sleep(2000);
		}
	}
}

function createAssociatedWallet(owner: PublicKey, tokenMint: PublicKey, associatedAccount: PublicKey) {
	return new TransactionInstruction({
			programId: ASSOCIATED_TOKEN_PROGRAM_ID,
			keys: [
				{
					pubkey: owner,
					isSigner: true,
					isWritable: true,
				},
				{
					pubkey: associatedAccount,
					isSigner: false,
					isWritable: true,
				},
				{
					pubkey: owner,
					isSigner: false,
					isWritable: false,
				},
				{
					pubkey: tokenMint,
					isSigner: false,
					isWritable: false,
				},
				{
					pubkey: SystemProgram.programId,
					isSigner: false,
					isWritable: false,
				},
				{
					pubkey: TOKEN_PROGRAM_ID,
					isSigner: false,
					isWritable: false,
				},
				{
					pubkey: SYSVAR_RENT_PUBKEY,
					isSigner: false,
					isWritable: false,
				},
			],
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

	const givePrice = await priceFeed.getUsdPrice(order.give.chainId, order.give.tokenAddress.toString("hex"));
	if (signal.aborted) return undefined;
	const takePrice = await priceFeed.getUsdPrice(order.take.chainId, order.take.tokenAddress.toString("hex"));
	if (signal.aborted) return undefined;
	const giveUsdAmonut = givePrice * order.give.amount;
	const takeUsdAmount = takePrice * order.take.amount;

	const profit = await profitChecker.getProfit(order.take.chainId, giveUsdAmonut, takeUsdAmount);
	if (signal.aborted) return undefined;

	if (profit < expectedProfit) return undefined;
	const takeMint = new PublicKey(order.take.tokenAddress);
	const [takerWallet] = await findAssociatedTokenAddress(taker.publicKey, takeMint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
	let walletExists = await connection.getAccountInfo(takerWallet);
	console.log(walletExists);
	if (signal.aborted) return undefined;
	if (walletExists === null) {
		const walletCreateIx = createAssociatedWallet(taker.publicKey, takeMint, takerWallet);
		try {
			await connection.sendTransaction(new Transaction().add(walletCreateIx), [taker]);
		} catch {}

		let walletInitialized = false;
		while (!walletInitialized) {
			if (signal.aborted) return undefined;
			const data = await connection.getAccountInfo(takerWallet);
			if (data !== null && data.owner.equals(TOKEN_PROGRAM_ID)) walletInitialized = true;
			if (signal.aborted) return undefined;
			await sleep(3000);
		}
	}
	if (signal.aborted) return undefined;

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

function getWallet(): Keypair {
	if (process.env.WALLET_DATA) {
		const keypairData = bs58.decode(process.env.WALLET_DATA);
		return Keypair.fromSecretKey(keypairData);
		
	} else if (process.env.ANCHOR_WALLET) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		const fileData = require("fs").readFileSync(process.env.ANCHOR_WALLET, {
			encoding: "utf-8",
		}) as string;
		const keypairData = Buffer.from(JSON.parse(fileData) as number[]);
		const keypair: Keypair = Keypair.fromSecretKey(keypairData);
		return keypair;
	} else {
		throw new Error("No wallet data provided!");
	}
}

async function main() {
	const taskMap = new Map<string, ReturnType<typeof wrapIntoAbortController>>();
	const orderBroker = new NextOrder();
	await orderBroker.init("PmmDevnetEvents");
	const expectedProfit = 123n; // TODO: move to env
	const connection = new Connection("https://api.devnet.solana.com"); // TODO: get connection endpoint from env
	const dstClient = new Solana.PMMDst(
		"dstFoo3xGxv23giLZBuyo9rRwXHdDMeySj7XXMj1Rqn",
		"F1nSne66G8qCrTVBa1wgDrRFHMGj8pZUZiqgxUrVtaAQ",
		"14bkTTDfycEShjiurAv1yGupxvsQcWevReLNnpzZgaMh",
		connection,
	); // TODO: get pmm dst/debridge/debridge settings addresses from env
	const taker: Keypair = getWallet(); // TODO: get taker wallet from env
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
			console.debug(order);
			previousOrderId = Order.calculateId(order);
			taskMap.set(
				previousOrderId,
				wrapIntoAbortController(orderProcessor, connection, dstClient, taker, beneficiary, order, feed, checker, expectedProfit),
			);
		}
	}
}

main()
	.then(() => {})
	.catch(console.error);
