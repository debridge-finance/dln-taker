import { ChainId, Evm, OrderData, OrderState, PMMClient, Solana, SwapConnector } from "@debridge-finance/pmm-client";
import { AdapterContainer, PriceFeed, ProviderAdapter } from "./interfaces";
import { Connection, Keypair, Transaction, PublicKey, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { readEnv } from "./helpers";
import { helpers, WRAPPED_SOL_MINT } from "@debridge-finance/solana-utils";
import Web3 from "web3";
import BigNumber from "bignumber.js";
import { WsNextOrder } from "./orderFeeds/ws.order.feed";
import { CoingeckoPriceFeed } from "./priceFeeds/coingecko.price.feed";
import { OneInchConnector } from "./connectors/one.inch.connector";

(BigInt.prototype as any).toJSON = function () {
	return this.toString();
};

class SolanaProvider implements ProviderAdapter {
	public wallet: Parameters<typeof helpers.sendAll>["1"];

	constructor(public connection: Connection, wallet: Keypair) {
		this.wallet = new helpers.Wallet(wallet);
	}

	public get address(): string {
		return helpers.bufferToHex(this.wallet.publicKey.toBuffer());
	}


	async sendTransaction(data: unknown) {
		const txid = await helpers.sendAll(
			this.connection,
			this.wallet,
			[data as Transaction | VersionedTransaction],
			undefined,
			undefined,
			false,
			true,
		);
		console.log(`[Solana] Sent tx: ${txid}`);
		return txid;
	}
}

class EvmProvider implements ProviderAdapter {
	wallet: never;

	constructor(public connection: Web3) { }

	public get address(): string {
		return this.connection.eth.defaultAccount!;
	}

	async sendTransaction(data: unknown) {
		const tx = data as { data: string; to: string; value: number };
		const gasLimit = await this.connection.eth.estimateGas(tx);
		const gasPrice = await this.connection.eth.getGasPrice();
		const result = await this.connection.eth.sendTransaction({
			...tx,
			from: this.connection.eth.defaultAccount!,
			gasPrice,
			gas: gasLimit,
		});
		console.log(`[EVM] Sent tx: ${result.transactionHash}`);

		return result;
	}
}

const feed = new CoingeckoPriceFeed();

type EmptyTuple = [];
type Head<T extends unknown[]> = T extends [...infer U, unknown] ? U : unknown[];
type OmitLastParam<F> = F extends (...args: infer P) => infer Ret
	? Head<P> extends EmptyTuple
	? () => Ret
	: (...args: Head<P>) => Ret
	: never;

function wrapIntoAbortController<T extends (...args: any[]) => Promise<any>>(fn: T, ...args: Parameters<OmitLastParam<T>>) {
	const controller = new AbortController();
	const { signal } = controller;
	fn(...args, signal).catch((e) => console.error(e));
	return controller;
}

async function orderProcessor(
	client: PMMClient,
	beneficiaryMap: Map<ChainId, string>,
	preswapMap: Map<ChainId, string>,
	connectorsMap: Map<ChainId, SwapConnector>,
	providers: AdapterContainer,
	order: OrderData,
	orderId: string,
	priceFeed: PriceFeed,
	expectedProfit: number,
	signal: AbortSignal,
): Promise<bigint | undefined> {
	if (signal.aborted) return undefined;

	const giveWeb3 = order.give.chainId != ChainId.Solana ? providers[order.give.chainId].connection as Web3 : undefined;
	const takeWeb3 = order.take.chainId != ChainId.Solana ? providers[order.take.chainId].connection as Web3 : undefined;
	const evmNative = "0x0000000000000000000000000000000000000000";
	const solanaNative = helpers.bufferToHex(WRAPPED_SOL_MINT.toBuffer());

	const giveAddress = helpers.bufferToHex(Buffer.from(order.give.tokenAddress))

	const pricesPromise = Promise.all([
		priceFeed.getPrice(order.give.chainId, order.give.chainId != ChainId.Solana ? evmNative : solanaNative),
		priceFeed.getPrice(order.take.chainId, order.take.chainId != ChainId.Solana ? evmNative : solanaNative),
		priceFeed.getPrice(order.give.chainId, giveAddress),
		priceFeed.getPrice(order.take.chainId, preswapMap.get(order.take.chainId)!),
		client.getDecimals(order.give.chainId, giveAddress, giveWeb3),
		client.getDecimals(order.take.chainId, preswapMap.get(order.take.chainId)!, takeWeb3),
	]);
	if (signal.aborted) return undefined;


	// if (profit < expectedProfit) return undefined;

	let preswapFulfillMeta;
	let preswapToken = preswapMap.get(order.take.chainId)!;
	// taker = signer
	if (order.take.chainId === ChainId.Solana)
		preswapFulfillMeta = await client.preswapAndFulfillOrder<ChainId.Solana>(order, orderId, preswapToken, { taker: (providers[order.take.chainId].wallet as { publicKey: PublicKey }).publicKey })
	else
		preswapFulfillMeta = await client.preswapAndFulfillOrder<ChainId.Ethereum>(order, orderId, preswapToken, {
			web3: providers[order.take.chainId].connection as Web3,
			fulfillAmount: Number(order.take.amount),
			permit: "0x",
			priceTokenService: priceFeed,
			slippage: 1,
			swapConnector: connectorsMap.get(order.take.chainId)!,
			takerAddress: providers[order.take.chainId].address,
		})

	if (signal.aborted) return undefined;

	let result;
	try {
		result = await pricesPromise;
	} catch (e) {
		console.error(e);
		return undefined;
	}
	const [giveNativePrice, takeNativePrice, givePrice, takePrice, giveDecimals, takeDecimals] = result;
	if (signal.aborted) return undefined;

	const fees = await client.getTakerFlowCost(order, giveNativePrice, takeNativePrice, { giveWeb3: (giveWeb3 || takeWeb3)!, takeWeb3: (takeWeb3 || giveWeb3)! });

	const giveUsdAmount = BigNumber(givePrice).
		multipliedBy(order.give.amount.toString()).
		dividedBy(new BigNumber(10).pow(giveDecimals));
	const takeUsdAmount = BigNumber(preswapFulfillMeta.fulfillAmountWithSlippage.toString()).multipliedBy(takePrice).dividedBy(BigNumber(10).pow(takeDecimals));
	const profit = takeUsdAmount.minus(giveUsdAmount).minus(fees.usdTotal);
	console.log(fees.executionFees);
	console.log(`Profit is: ${profit}, fees: ${fees.usdTotal}, giveAmount: ${giveUsdAmount}, takeAmount: ${takeUsdAmount}`);
	//if (profit.lt(expectedProfit)) return undefined;
	if (signal.aborted) return undefined;


	try {
		const txId = await providers[order.take.chainId].sendTransaction(preswapFulfillMeta.tx);
		console.log(`Fulfill: ${txId} `);
	} catch (e) {
		// TODO: monitoring
		console.error(e);
		return undefined;
	}

	let state = await client.getTakeOrderStatus(orderId, order.take.chainId, { web3: takeWeb3! });
	while (state === null || state.status !== OrderState.Fulfilled) {
		state = await client.getTakeOrderStatus(orderId, order.take.chainId, { web3: takeWeb3! });
		await helpers.sleep(2000);
	}

	let unlockIx;

	// calc amount to send with transfer fee
	const executionFeeAmount = await client.getAmountToSend(order.take.chainId, order.give.chainId, fees.executionFees.total, takeWeb3);
	if (order.take.chainId === ChainId.Solana) {
		unlockIx = await client.sendUnlockOrder<ChainId.Solana>(order, beneficiaryMap.get(order.give.chainId)!, executionFeeAmount, {
			unlocker: (providers[order.take.chainId].wallet as { publicKey: PublicKey }).publicKey,
		});
	} else {
		let rewards = order.give.chainId === ChainId.Solana ?
			{
				reward1: fees.executionFees.rewards[0].toString(),
				reward2: fees.executionFees.rewards[1].toString(),
			} : {
				reward1: "0",
				reward2: "0",
			}

		unlockIx = await client.sendUnlockOrder<ChainId.Polygon>(order, beneficiaryMap.get(order.give.chainId)!, executionFeeAmount, {
			web3: providers[order.take.chainId].connection as Web3,
			...rewards
		});
	}

	try {
		const txId2 = await providers[order.take.chainId].sendTransaction(unlockIx);
		console.log(`Send unlock: ${txId2} `);
	} catch (e) {
		// TODO: monitoring
		console.error(e);
		return undefined;
	}

}

async function main() {
	const [config, enabledChains] = readEnv();

	const taskMap = new Map<string, ReturnType<typeof wrapIntoAbortController>>();

	const orderBroker = new WsNextOrder(config.WS_URL, enabledChains);

	const adapters = {} as AdapterContainer;
	const pmmClient = new PMMClient({});
	const beneficiaryMap: Map<ChainId, string> = new Map();
	const preswapMap = new Map<ChainId, string>();
	const swapConnectors = new Map<ChainId, SwapConnector>();
	const oneInchConnector = new OneInchConnector("https://api.1inch.io");

	const preswapTokens: Record<number, string> = {
		[ChainId.Solana]: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // usdc
		[ChainId.Polygon]: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // usdc
		[ChainId.BSC]: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", // BUSD
	}

	type EvmChainInfo = NonNullable<ConstructorParameters<typeof Evm.PmmEvmClient>[0]>["addresses"];
	const evmAddresses = {} as EvmChainInfo;

	for (const chain of enabledChains) {
		if (chain === ChainId.Solana) {
			adapters[chain] = new SolanaProvider(
				new Connection(config[chain].RPC_URL, { confirmTransactionInitialTimeout: 1000, commitment: "confirmed" }),
				Keypair.fromSecretKey(helpers.hexToBuffer(config[chain].WALLET)),
			);
			pmmClient.updateClient(
				chain,
				new Solana.PmmClient(
					adapters[chain].connection as Connection,
					config[chain].PMM_SRC,
					config[chain].PMM_DST,
					config[chain].DEBRIDGE,
					config[chain].DEBRIDGE_SETTINGS!,
				),
			);
		} else {
			const web3 = new Web3(config[chain].RPC_URL);
			const account = web3.eth.accounts.privateKeyToAccount(config[chain].WALLET);
			web3.eth.accounts.wallet.add(account);
			web3.eth.defaultAccount = account.address;
			adapters[chain] = new EvmProvider(web3);
			evmAddresses[chain] = {
				deBridgeGateAddress: config[chain].DEBRIDGE,
				pmmDestinationAddress: config[chain].PMM_DST,
				pmmSourceAddress: config[chain].PMM_SRC,
			} as EvmChainInfo[number];
			swapConnectors.set(chain, oneInchConnector);
		}
		beneficiaryMap.set(chain, config[chain].BENEFICIARY);
		preswapMap.set(chain, preswapTokens[chain]);

	}

	const evmClient = new Evm.PmmEvmClient({ addresses: evmAddresses, enableContractsCache: true });
	const initSolana = Promise.all([
		(pmmClient.getClient(ChainId.Solana) as Solana.PmmClient).destination.debridge.init(),
		(async () => {
			const tx = await (pmmClient.getClient(ChainId.Solana) as Solana.PmmClient).initForFulfillPreswap((adapters[ChainId.Solana].wallet as helpers.Wallet).publicKey, [])
			if (tx) {
				await adapters[ChainId.Solana].sendTransaction(tx);
			}
		})()
	]);

	for (const chain of Object.keys(evmAddresses)) {
		pmmClient.updateClient(Number(chain), evmClient);
	}

	const takers = enabledChains.map((chain) => adapters[chain].address);
	console.log(takers);
	await initSolana;

	while (true) {
		const { order, orderId, type, taker } = await orderBroker.getNextOrder();
		console.log(type, order);
		if (type === "created") {
			taskMap.set(
				orderId,
				wrapIntoAbortController(orderProcessor, pmmClient, beneficiaryMap, preswapMap, swapConnectors, adapters, order!, orderId, feed, config.EXPECTED_PROFIT),
			);
		} else {
			const task = taskMap.get(orderId);
			if (task === undefined) continue;
			if (type === "fulfilled" && takers.includes(taker!)) continue;
			task?.abort();

		}
	}
}

main()
	.then(() => { })
	.catch(console.error);
