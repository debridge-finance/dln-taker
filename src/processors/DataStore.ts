import { StatsAPI } from "./StatsAPI";
import { ChainId, OrderDataWithId } from "@debridge-finance/dln-client";
import { IExecutor } from "../executors/executor";
import { helpers } from "@debridge-finance/solana-utils";

export class DataStore {
    private statsApi: StatsAPI = new StatsAPI;

    constructor(private executor: IExecutor) {}

    async getPendingForUnlockOrders(from: ChainId): Promise<Array<OrderDataWithId>> {
        const orderIds = await this.getPendingForUnlockOrderIds(from);
        const orders: OrderDataWithId[] = []
        for (const orderId of orderIds) {
            const order = this.convertOrder(await this.statsApi.getOrderLiteModel(orderId));
            orders.push(order);
        }

        return orders;
    }

    private async getPendingForUnlockOrderIds(from: ChainId): Promise<string[]> {
        const unlockAuthorities = this.executor.getSupportedChainIds()
          .map(chainId => this.executor.getSupportedChain(chainId).unlockProvider.address);

        let skip = 0;
        const orderIds: string[] = [];
        do {
            const getForUnlockOrders = await this.statsApi.getForUnlockAuthorities(
                [from],
                ["Fulfilled", "SentUnlock"],
                unlockAuthorities,
                skip,
                100 // take
            );
            skip += getForUnlockOrders.orders.length;
            orderIds.push(
                ...getForUnlockOrders.orders.map(orderDTO => orderDTO.orderId.stringValue)
            )

            if (
                getForUnlockOrders.orders.length === 0
                || orderIds.length >= getForUnlockOrders.totalCount
            ) {
                break;
            }
        } while (true);

        return orderIds
    }

    private convertOrder(order: Awaited<ReturnType<StatsAPI['getOrderLiteModel']>>): OrderDataWithId {
        return {
            orderId: helpers.hexToBuffer(order.orderId.stringValue),

            nonce: BigInt(order.makerOrderNonce),
            maker: this.parseBytesArray(order.makerSrc.bytesArrayValue),
            give: {
                tokenAddress: this.parseBytesArray(order.giveOffer.tokenAddress.bytesArrayValue),
                amount: BigInt(order.giveOffer.amount.stringValue),
                chainId: Number(order.giveOffer.chainId.stringValue)
            },
            take: {
                tokenAddress: this.parseBytesArray(order.takeOffer.tokenAddress.bytesArrayValue),
                amount: BigInt(order.takeOffer.amount.stringValue),
                chainId: Number(order.takeOffer.chainId.stringValue)
            },
            receiver: this.parseBytesArray(order.receiverDst.bytesArrayValue),
            givePatchAuthority: this.parseBytesArray(order.givePatchAuthoritySrc.bytesArrayValue),
            orderAuthorityDstAddress: this.parseBytesArray(order.orderAuthorityAddressDst.bytesArrayValue),
            allowedTaker: order.allowedTakerDst.bytesArrayValue ? this.parseBytesArray(order.allowedTakerDst.bytesArrayValue) : undefined,
            allowedCancelBeneficiary: order.allowedCancelBeneficiarySrc.bytesArrayValue ? this.parseBytesArray(order.allowedCancelBeneficiarySrc.bytesArrayValue) : undefined,
            externalCall: undefined
        }
    }

    private parseBytesArray(bytesArrayString: string): Uint8Array {
        return new Uint8Array(JSON.parse(bytesArrayString))
    }
}
