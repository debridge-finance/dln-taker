import { GetNextOrder, NextOrderInfo } from "./interfaces";
import { connect, Socket } from "socket.io-client";
import { ChainId, Offer, Order, OrderData } from "@debridge-finance/pmm-client";
import { U256 } from "./helpers";
import { helpers } from "@debridge-finance/solana-utils";

type WsOrderOffer = {
    chain_id: string;
    token_address: string;
    amount: string;
}

type WsOrder = {
    maker_order_nonce: string;
    maker_src: string;
    give: WsOrderOffer;
    take: WsOrderOffer;
    receiver_dst: string;
    give_patch_authority_src: string;
    order_authority_address_dst: string;
    allowed_taker_dst: string | null;
    allowed_cancel_beneficiary_src: string | null;
    external_call: null;
}

type WsOrderInfo = {
    order_id: string;
    order: WsOrder;
}

export class WsNextOrder implements GetNextOrder {
    private socket: Socket;
    private queue: OrderData[];

    private wsOfferToOffer(info: WsOrderOffer): Offer {
        return {
            amount: U256.fromBytesBE(helpers.hexToBuffer(info.amount)).toBigInt(),
            chainId: Number(U256.fromHexBEString(info.chain_id).toBigInt()),
            tokenAddress: helpers.hexToBuffer(info.token_address)
        }
    }

    private wsOrderToOrderData(info: WsOrderInfo): OrderData {
        const order: OrderData = {
            nonce: U256.fromBytesBE(helpers.hexToBuffer(info.order.maker_order_nonce)).toBigInt(),
            give: this.wsOfferToOffer(info.order.give),
            take: this.wsOfferToOffer(info.order.take),
            givePatchAuthority: helpers.hexToBuffer(info.order.give_patch_authority_src),
            maker: helpers.hexToBuffer(info.order.maker_src),
            orderAuthorityDstAddress: helpers.hexToBuffer(info.order.order_authority_address_dst),
            receiver: helpers.hexToBuffer(info.order.receiver_dst),
            allowedCancelBeneficiary: info.order.allowed_cancel_beneficiary_src ? helpers.hexToBuffer(info.order.allowed_cancel_beneficiary_src) : undefined,
            allowedTaker: info.order.allowed_taker_dst ? helpers.hexToBuffer(info.order.allowed_taker_dst) : undefined,
            externalCall: undefined,
        }
        const calculatedId = Order.calculateId(order);
        if (calculatedId != info.order_id) throw new Error(`OrderId mismatch!\nProbably error during conversions between formats\nexpected id: ${info.order_id}\ncalculated: ${calculatedId}\nReceived order: ${info.order}\nTransformed: ${order}`);
        return order;
    }

    constructor(wsUrl: string, private enabledChains: ChainId[]) {
        this.socket = connect(wsUrl, { reconnection: true })
        this.queue = [];
        this.socket.onAny((event: string, ...args) => {
            if (event === "xxx") {
                const order = this.wsOrderToOrderData(args[0]);
                this.queue.push(order);
            }
        })
    }

    async getNextOrder(): Promise<NextOrderInfo> {
        while (true) {
            if (this.queue.length > 0) {
                const order = this.queue.shift()!;
                if (!this.enabledChains.includes(order.take.chainId) || !(this.enabledChains.includes(order.give.chainId))) continue;
            }
        }
    }
}