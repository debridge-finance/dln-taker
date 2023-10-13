import { OrderData, OrderDataWithId, Order as OrderUtils, buffersAreEqual, getEngineByChainId, ChainEngine, } from "@debridge-finance/dln-client";
import { findExpectedBucket } from "@debridge-finance/legacy-dln-profitability";
import { helpers } from "@debridge-finance/solana-utils";
import assert from "assert";
import { SwapConnectorResult } from "node_modules/@debridge-finance/dln-client/dist/types/swapConnector/swap.connector";
import { Logger } from "pino";
import { EVMOrderValidator } from "src/chain-evm/order-validator";
import { BLOCK_CONFIRMATIONS_HARD_CAPS, SupportedChain } from "../config";
import { IExecutor, ExecutorSupportedChain, SrcConstraintsPerOrderValue, SrcOrderConstraints, DstOrderConstraints } from "../executor";
import { OrderId, OrderInfoStatus } from "../interfaces";
import { OrderValidator } from "./order-validator";

type CreatedOrderContext = {
    executor: IExecutor;
    giveChain: ExecutorSupportedChain;
    takeChain: ExecutorSupportedChain;
    logger: Logger
}
export type OrderEvaluationPayload = { estimation?: SwapConnectorResult } & {
    [key in string]: any;
}

export abstract class OrderEvaluationContextual {
    readonly #payload: OrderEvaluationPayload = {};

    constructor(base?: OrderEvaluationPayload) {
        if (base)
            this.#payload = base;
    }

    protected setPayloadEntry<T>(key: string, value: T) {
        assert(this.#payload[key] === undefined, `OrderValidator: accidentally overwriting the ${key} payload entry`);
        this.#payload[key] = value;
    }

    protected getPayloadEntry<T>(key: string): T {

        assert(
            typeof this.#payload[key] !== undefined,
            `payload does not contain ${key}`
        )

        return this.#payload[key]
    }

    protected get payload () {return this.#payload}
}

export class CreatedOrder {
    public readonly executor: IExecutor;
    public readonly giveChain: ExecutorSupportedChain;
    public readonly takeChain: ExecutorSupportedChain;
    readonly #logger: Logger;
    #arrivedAt: Date = new Date;
    #attempts: number = 0;

    get attempts(): number {
        return this.#attempts
    }

    get arrivedAt(): Date {
        return this.#arrivedAt
    }

    async getUsdValue(): Promise<number> {
        const value = await this.executor.usdValueOfOrder(this.orderData);
        // round up to 2 decimals
        return Math.round(value * 100) / 100;
    }

    get giveTokenAsString(): string {
        return this.orderData.give.tokenAddress.toAddress(this.orderData.give.chainId)
    }

    get takeTokenAsString(): string {
        return this.orderData.give.tokenAddress.toAddress(this.orderData.give.chainId)
    }

    get route() {
        const route = findExpectedBucket(this.orderData, this.executor.buckets);
        return {
            ...route,
            requiresSwap: buffersAreEqual(route.reserveDstToken, this.orderData.take.tokenAddress)
        }
    }

    async getGiveAmountInReserveToken(): Promise<bigint> {
        return this.executor.resyncDecimals(
            this.orderData.give.chainId,
            this.orderData.give.tokenAddress,
            this.orderData.give.amount,
            this.orderData.take.chainId,
            this.orderData.take.tokenAddress
        );
    }

    async getMaxProfitableReserveAmount() :Promise<bigint> {
        // getting the rough amount we are willing to spend after reserving our intended margin
        const margin = BigInt(this.giveChain.srcConstraints.profitability);
        const reserveDstAmount = await this.getGiveAmountInReserveToken();
        const amount = reserveDstAmount * (10_000n - margin) / 10_000n;
        return amount
    }

    get blockConfirmations(): number {
        if (this.finalization === 'Finalized') return BLOCK_CONFIRMATIONS_HARD_CAPS[this.giveChain.chain as unknown as SupportedChain]
        return this.finalization;
    }

    public async srcConstraints(): Promise<SrcOrderConstraints> {
        const usdValue = await this.getUsdValue();
        // compare worthiness of the order against block confirmation thresholds
        // find corresponding srcConstraints
        const srcConstraintsByValue = this.giveChain.srcConstraints.perOrderValue.find(
            (srcConstraints) => usdValue <= srcConstraints.upperThreshold,
        );
        return srcConstraintsByValue || this.giveChain.srcConstraints;
    }

    public async srcConstraintsRange(): Promise<SrcConstraintsPerOrderValue | undefined> {
        const usdValue = await this.getUsdValue();
        // compare worthiness of the order against block confirmation thresholds
        // find corresponding srcConstraints
        return this.giveChain.srcConstraints.perOrderValue.find(
            (srcConstraints) => usdValue <= srcConstraints.upperThreshold,
        );
    }

    public async dstConstraints(): Promise<DstOrderConstraints> {
        const usdValue = await this.getUsdValue();

        // find corresponding dstConstraints (they may supersede srcConstraints)
        const dstConstraintsByValue =
            this.takeChain.dstConstraints.perOrderValue.find(
                (dstConstraints) => usdValue <= dstConstraints.upperThreshold,
            );

        return dstConstraintsByValue || this.takeChain.dstConstraints;
    }

    constructor(
        public readonly orderId: OrderId,
        public readonly orderData: OrderData,
        public readonly status: OrderInfoStatus,
        public readonly finalization: "Finalized" | number,
        context: CreatedOrderContext
    ) {
        assert(
            [OrderInfoStatus.ArchivalCreated, OrderInfoStatus.Created].includes(status),
            `unexpected order status: ${OrderInfoStatus[status]}`
        );
        this.executor = context.executor;
        this.giveChain = context.giveChain;
        this.takeChain = context.takeChain;
        this.#logger = context.logger.child({ orderId });
    }

    update(finalization: "Finalized" | number): CreatedOrder {
        const order = new CreatedOrder(
            this.orderId,
            this.orderData,
            this.status,
            finalization,
            {
                executor: this.executor,
                giveChain: this.giveChain,
                takeChain: this.takeChain,
                logger: this.#logger
            }
        );
        order.#arrivedAt = order.#arrivedAt;
        order.#attempts = this.#attempts;
        return order;
    }

    async verify(): ReturnType<OrderValidator['verify']> {
        return this.getVerifier().verify()
    }

    getVerifier(): OrderValidator {
        switch (getEngineByChainId(this.takeChain.chain)) {
            case ChainEngine.EVM: return new EVMOrderValidator(this, { logger: this.#logger })
            default: return new OrderValidator(this, { logger: this.#logger })
        }
    }

    getWithId(): OrderDataWithId {
        return OrderUtils.getVerified({ orderId: helpers.hexToBuffer(this.orderId), ...this.orderData })
    }
}