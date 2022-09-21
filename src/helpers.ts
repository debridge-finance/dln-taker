import { U256, EventCreatedSrc, Order } from "./pmm_common";
import { OrderData } from "@debridge-finance/pmm-client";

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

export function eventToOrderData(event: Order): OrderData {
	const orderData: OrderData = {
		give: {
			amount: U256ToBigint(event.give!.amount!),
			chainId: U256ToBigint(event.give!.chainId!),
			tokenAddress: Buffer.from(event.give!.tokenAddress!.address),
		},
		take: {
			amount: U256ToBigint(event.take!.amount!),
			chainId: U256ToBigint(event.take!.chainId!),
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
