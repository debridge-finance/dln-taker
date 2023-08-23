import { ChainId, OrderDataWithId } from "@debridge-finance/dln-client";
import { helpers } from "@debridge-finance/solana-utils";
import { StatsAPI } from "./StatsAPI";
import { IExecutor } from "../executors/executor";

export class DataStore {
    private statsApi: StatsAPI = new StatsAPI;

    constructor(private executor: IExecutor) {}

    async getPendingForUnlockOrders(from: ChainId): Promise<Array<OrderDataWithId>> {
        const orderIds = await this.getPendingForUnlockOrderIds(from);
        const orders: OrderDataWithId[] = []
        for (const orderId of orderIds) {
            // eslint-disable-next-line no-await-in-loop -- Very ugly but intentionally acceptable unless TVLBudget feature gets exposure OR dln-taker starts using StatsApi heavily during the initialization TODO #862karugz
            const order = DataStore.convertOrder(await this.statsApi.getOrderLiteModel(orderId));
            orders.push(order);
        }

        return orders;
    }

    private async getPendingForUnlockOrderIds(from: ChainId): Promise<string[]> {
        const unlockAuthorities = this.executor.getSupportedChainIds()
          .map(chainId => this.executor.getSupportedChain(chainId).unlockProvider.address);

        let skip = 0;
        let hasMoreOrders = true;
        const orderIds: string[] = [];
        while (hasMoreOrders) {
            // eslint-disable-next-line no-await-in-loop -- Pagination is intentionally acceptable here
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
                hasMoreOrders = false;
            }
        }

        return orderIds
    }

    private static convertOrder(order: Awaited<ReturnType<StatsAPI['getOrderLiteModel']>>): OrderDataWithId {
        return {
            orderId: helpers.hexToBuffer(order.orderId.stringValue),

            nonce: BigInt(order.makerOrderNonce),
            maker: DataStore.parseBytesArray(order.makerSrc.bytesArrayValue),
            give: {
                tokenAddress: DataStore.parseBytesArray(order.giveOffer.tokenAddress.bytesArrayValue),
                amount: BigInt(order.giveOffer.amount.stringValue),
                chainId: Number(order.giveOffer.chainId.stringValue)
            },
            take: {
                tokenAddress: DataStore.parseBytesArray(order.takeOffer.tokenAddress.bytesArrayValue),
                amount: BigInt(order.takeOffer.amount.stringValue),
                chainId: Number(order.takeOffer.chainId.stringValue)
            },
            receiver: DataStore.parseBytesArray(order.receiverDst.bytesArrayValue),
            givePatchAuthority: DataStore.parseBytesArray(order.givePatchAuthoritySrc.bytesArrayValue),
            orderAuthorityDstAddress: DataStore.parseBytesArray(order.orderAuthorityAddressDst.bytesArrayValue),
            allowedTaker: order.allowedTakerDst.bytesArrayValue ? DataStore.parseBytesArray(order.allowedTakerDst.bytesArrayValue) : undefined,
            allowedCancelBeneficiary: order.allowedCancelBeneficiarySrc.bytesArrayValue ? DataStore.parseBytesArray(order.allowedCancelBeneficiarySrc.bytesArrayValue) : undefined,
            externalCall: undefined
        }
    }

    private static parseBytesArray(bytesArrayString: string): Uint8Array {
        return new Uint8Array(JSON.parse(bytesArrayString))
    }
}
