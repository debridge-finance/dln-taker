import { U256, EventCreatedSrc, Order } from "./pmm_common";
import { ChainId, OrderData } from "@debridge-finance/pmm-client";
import { ChainConfig, Config } from "./interfaces";
import { config } from "dotenv";

export function readEnv(): [Config, ChainId[]] {
	const { parsed } = config({ path: "./src/.env" });
	if (!parsed) throw new Error("Failed to parse config");

	let enabledChains = [];
	if (["EXPECTED_PROFIT", "RABBIT_URL", "QUEUE_NAME"].map((v) => v in parsed).find((v) => v === false) !== undefined)
		throw new Error("Wrong config");
	let result = {
		EXPECTED_PROFIT: BigInt(parsed.EXPECTED_PROFIT),
		RABBIT_URL: parsed.RABBIT_URL,
		QUEUE_NAME: parsed.QUEUE_NAME,
	} as Config;
	const keys = ["DEBRIDGE", "PMM_DST", "PMM_SRC", "RPC_URL", "BENEFICIARY", "WALLET"];
	for (const chain of Object.values(ChainId) as number[]) {
		if (`${chain}.WALLET` in parsed) {
			enabledChains.push(chain);
			const chainCfg = Object.fromEntries(keys.map((key) => [key, parsed[`${chain}.${key}`]])) as ChainConfig;
			if (`${chain}.DEBRIDGE_SETTINGS` in parsed) chainCfg.DEBRIDGE_SETTINGS = parsed[`${chain}.DEBRIDGE_SETTINGS`];
			result[chain] = chainCfg;
		}
	}
	console.log(result, enabledChains);

	return [result, enabledChains];
}

export function U256ToBytesBE(u: U256) {
	const result = Buffer.alloc(32);
	const shifts = Array.from({ length: 8 })
		.fill(0n)
		.map((v, i) => BigInt(56 - 8 * i));
	for (let i = 0; i < 32; i++) {
		switch (Math.floor(i / 8)) {
			case 0:
				result[i] = Number((u.limb4 >> shifts[i % 8]) & 0xffn);
				break;
			case 1:
				result[i] = Number((u.limb3 >> shifts[i % 8]) & 0xffn);
				break;
			case 2:
				result[i] = Number((u.limb2 >> shifts[i % 8]) & 0xffn);
				break;
			case 3:
				result[i] = Number((u.limb1 >> shifts[i % 8]) & 0xffn);
				break;
		}
	}
	return result;
}

export function U256ToBigint(u: U256) {
	return u.limb1 + (u.limb2 << BigInt(8 * 8 * 1)) + (u.limb3 << BigInt(8 * 8 * 2)) + (u.limb4 << BigInt(8 * 8 * 3));
}

function BytesToU64(data: Buffer, encoding: "le" | "be"): bigint {
	let result: bigint = 0n;
	const beOrder = [0, 1, 2, 3, 4, 5, 6, 7];
	let counter = 0;
	for (let i of encoding === "le" ? beOrder.reverse() : beOrder) {
		result += BigInt(data[i]) << BigInt(8 * counter);
	}
	return result;
}

export function BytesBEToU256(data: Buffer) { }

export function bigintToU256(n: bigint): U256 {
	const u64Mask = 0xffffffffffffffffn;
	const u64Shift = 8;
	const limb1 = n & u64Mask;
	const limb2 = (n >> BigInt(u64Shift * 1)) & u64Mask;
	const limb3 = (n >> BigInt(u64Shift * 2)) & u64Mask;
	const limb4 = (n >> BigInt(u64Shift * 3)) & u64Mask;
	return {
		limb1,
		limb2,
		limb3,
		limb4,
	};
}

export function eventToOrderData(event: Order): OrderData {
	const orderData: OrderData = {
		give: {
			amount: U256ToBigint(event.give!.amount!),
			chainId: Number(U256ToBigint(event.give!.chainId!)),
			tokenAddress: Buffer.from(event.give!.tokenAddress!.address),
		},
		take: {
			amount: U256ToBigint(event.take!.amount!),
			chainId: Number(U256ToBigint(event.take!.chainId!)),
			tokenAddress: Buffer.from(event.take!.tokenAddress!.address),
		},
		maker: Buffer.from(event.makerSrc?.address!),
		givePatchAuthority: Buffer.from(event.givePatchAuthoritySrc!.address),
		nonce: event.makerOrderNonce,
		orderAuthorityDstAddress: Buffer.from(event.orderAuthorityAddressDst!.address),
		receiver: Buffer.from(event.receiverDst!.address),
		allowedCancelBeneficiary: event.allowedCancelBeneficiarySrc ? Buffer.from(event.allowedCancelBeneficiarySrc.address) : undefined,
		allowedTaker: event.allowedTakerDst ? Buffer.from(event.allowedTakerDst.address) : undefined,
		externalCall: event.externalCall
			? {
				executionFee: U256ToBigint(event.externalCall.executionFee!),
				externalCallHash: U256ToBytesBE(event.externalCall.hashOfExternalCall!),
				fallbackDstAddress: Buffer.from(event.externalCall.fallbackAddressDst!.address),
			}
			: undefined,
	};
	return orderData;
}
