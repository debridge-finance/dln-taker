import { buffersAreEqual } from "@debridge-finance/dln-client";
import { calculateExpectedTakeAmount } from "@debridge-finance/legacy-dln-profitability";
import { SwapConnectorResult } from "node_modules/@debridge-finance/dln-client/dist/types/swapConnector/swap.connector";
import { Logger } from "pino";
import { assert } from "../errors";
import { createClientLogger } from "../logger";
import { CreatedOrder, OrderEvaluationContextual, OrderEvaluationPayload } from "./order";

type OrderEstimatorContext = {
    logger: Logger;
    preferEstimation?: SwapConnectorResult;
    validationPayload: OrderEvaluationPayload
}

function getPreFulfillSlippage(evaluatedTakeAmount: bigint, takeAmount: bigint): number {
    const preFulfillSwapMinAllowedSlippageBps = 5;
    const preFulfillSwapMaxAllowedSlippageBps = 400;
    const calculatedSlippageBps =
      ((evaluatedTakeAmount - takeAmount) * 10000n) / evaluatedTakeAmount;
    if (calculatedSlippageBps < preFulfillSwapMinAllowedSlippageBps)
      return preFulfillSwapMinAllowedSlippageBps;
    if (calculatedSlippageBps > preFulfillSwapMaxAllowedSlippageBps)
      return preFulfillSwapMaxAllowedSlippageBps;
    return Number(calculatedSlippageBps);
  }

// wrapped version of the result of calculateExpectedTakeAmount()
export class RawOrderEstimation {
    public isProfitable: boolean
    public reserveToken: Uint8Array
    public requiredReserveAmount: bigint
    public projectedFulfillAmount: bigint

    constructor(rawEstimation: Awaited<ReturnType<typeof calculateExpectedTakeAmount>>) {
        this.isProfitable = rawEstimation.isProfitable;
        this.reserveToken = rawEstimation.reserveDstToken;
        this.requiredReserveAmount = BigInt(rawEstimation.requiredReserveDstAmount);
        this.projectedFulfillAmount = BigInt(rawEstimation.profitableTakeAmount)
    }

    toOrderEstimation(payload?: OrderEvaluationPayload): OrderEstimation {
      return {
        isProfitable: this.isProfitable,
        requiredReserveAmount: this.requiredReserveAmount,
        projectedFulfillAmount: this.projectedFulfillAmount,
        preFulfillSwapResult: undefined,
        payload: payload || {}
      }
    }
}

export type OrderEstimation = {
    readonly isProfitable: boolean
    readonly requiredReserveAmount: bigint
    readonly projectedFulfillAmount: bigint
    readonly preFulfillSwapResult: SwapConnectorResult | undefined;
    readonly payload: OrderEvaluationPayload
}

export class OrderEstimator extends OrderEvaluationContextual {
    protected readonly logger: Logger;

  constructor(protected readonly order: CreatedOrder, protected readonly context: OrderEstimatorContext) {
      super(context.validationPayload)
       this.logger = context.logger.child({ service: OrderEstimator.name })
    }

    protected async getExpectedTakeAmountContext(): Promise<Parameters<typeof calculateExpectedTakeAmount>['2']> {
      return {
        client: this.order.executor.client,
        priceTokenService: this.order.executor.tokenPriceService,
        buckets: this.order.executor.buckets,
        swapConnector: this.order.executor.swapConnector,
        logger: createClientLogger(this.logger),
        batchSize: await this.getBatchUnlockSizeForProfitability(),
        swapEstimationPreference: this.context.preferEstimation,
      }
    }

    protected async getRawOrderEstimation(): Promise<RawOrderEstimation> {
        return calculateExpectedTakeAmount(
            this.order.orderData,
            this.order.giveChain.srcConstraints.profitability,
            await this.getExpectedTakeAmountContext(),
        )
        .then(result => new RawOrderEstimation(result))
    }

    async getEstimation(): Promise<OrderEstimation> {
        const rawOrderEstimation = await this.getRawOrderEstimation();

        // ensure dln-taker's algo aligns with calculateExpectedTakeAmount behaviour
        assert(
            buffersAreEqual(rawOrderEstimation.reserveToken, this.order.route.reserveDstToken),
            `dln-taker has picked ${this.order.route.reserveDstToken.toAddress(this.order.takeChain.chain)} as reserve token, while calculateExpectedTakeAmount returned ${rawOrderEstimation.reserveToken.toAddress(this.order.takeChain.chain)}`,
        );

        // provide a swap that would be executed upon fulfillment: this is crucial because this swap may be outdated
        // making estimation not profitable
        let swapResult;
        if (this.order.route.requiresSwap) {
            swapResult = await this.order.executor.swapConnector.getSwap(
                {
                    amountIn: rawOrderEstimation.requiredReserveAmount,
                    chainId: this.order.orderData.take.chainId,
                    fromTokenAddress: rawOrderEstimation.reserveToken,
                    toTokenAddress: this.order.orderData.take.tokenAddress,
                    slippageBps: getPreFulfillSlippage(rawOrderEstimation.projectedFulfillAmount, this.order.orderData.take.amount),
                    preferEstimation: this.context.preferEstimation,
                    fromAddress: this.order.takeChain.fulfillProvider.bytesAddress,
                    destReceiver: this.order.executor.client.getForwarderAddress(this.order.orderData.take.chainId),
                },
                {
                  logger: createClientLogger(this.logger),
                },
            );

            rawOrderEstimation.projectedFulfillAmount = swapResult.amountOut;
            if (swapResult.amountOut < this.order.orderData.take.amount) {
                rawOrderEstimation.isProfitable = false;
            }
        }

        return {
          ...rawOrderEstimation.toOrderEstimation(this.payload),
          preFulfillSwapResult: swapResult,
        }

        // this.sendHook();
    }

    protected async getBatchUnlockSizeForProfitability(): Promise<number> {
        const { unlockBatchSize, immediateUnlockAtUsdValue } = this.order.giveChain.srcConstraints;
        if (immediateUnlockAtUsdValue) {
            const usdValue = await this.order.getUsdValue();
            if (usdValue >= immediateUnlockAtUsdValue) {
                return 1;
            }
        }

        // use default for any order
        return unlockBatchSize;
    }

    // protected sendHook() {
    //     assert(undefined !== this.#estimation, "Unexpected: hook triggered before estimation is performed on OrderEstimator")

    //     const { reserveDstToken, requiredReserveDstAmount, isProfitable, profitableTakeAmount } =
    //         this.#estimation;

    //     const hookEstimation = {
    //         isProfitable,
    //         reserveToken: reserveDstToken,
    //         requiredReserveAmount: requiredReserveDstAmount,
    //         fulfillToken: this.order.orderData.take.tokenAddress,
    //         projectedFulfillAmount: profitableTakeAmount,
    //     };
    //     this.order.executor.hookEngine.handleOrderEstimated({
    //         order: {
    //             orderId: this.order.orderId,
    //             status: this.order.status,
    //             order: this.order.orderData
    //         },
    //         estimation: hookEstimation,
    //         context: {
    //             logger: this.#logger,
    //             giveChain: this.order.giveChain,
    //             takeChain: this.order.takeChain,
    //             config: this.order.executor
    //         },
    //     });
    // }
}


