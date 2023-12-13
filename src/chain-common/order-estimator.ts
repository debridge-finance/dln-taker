import { buffersAreEqual } from '@debridge-finance/dln-client';
import { calculateExpectedTakeAmount } from '@debridge-finance/legacy-dln-profitability';
import { Logger } from 'pino';
import { assert } from '../errors';
import { createClientLogger } from '../dln-ts-client.utils';
import { CreatedOrder } from './order';
import './mixins';
import { OrderEvaluationContextual, OrderEvaluationPayload } from './order-evaluation-context';

type OrderEstimatorContext = {
  logger: Logger;
  validationPayload: OrderEvaluationPayload;
};

function getPreFulfillSlippage(evaluatedTakeAmount: bigint, takeAmount: bigint): number {
  const preFulfillSwapMinAllowedSlippageBps = 5;
  const preFulfillSwapMaxAllowedSlippageBps = 400;
  const calculatedSlippageBps = ((evaluatedTakeAmount - takeAmount) * 10000n) / evaluatedTakeAmount;
  if (calculatedSlippageBps < preFulfillSwapMinAllowedSlippageBps)
    return preFulfillSwapMinAllowedSlippageBps;
  if (calculatedSlippageBps > preFulfillSwapMaxAllowedSlippageBps)
    return preFulfillSwapMaxAllowedSlippageBps;
  return Number(calculatedSlippageBps);
}

export async function explainEstimation(orderEstimation: OrderEstimation): Promise<string> {
  const takeAmountDrop =
    (orderEstimation.projectedFulfillAmount * 10_000n) /
    orderEstimation.order.orderData.take.amount;
  const takeAmountDropShare = Number(10_000n - takeAmountDrop) / 100;

  const reserveTokenDesc = orderEstimation.order.route.reserveDstToken.toAddress(
    orderEstimation.order.takeChain.chain,
  );
  const takeTokenDesc = orderEstimation.order.orderData.take.tokenAddress.toAddress(
    orderEstimation.order.takeChain.chain,
  );

  return [
    `order is estimated to be profitable when supplying `,
    `${await orderEstimation.order.executor.formatTokenValue(
      orderEstimation.order.orderData.take.chainId,
      orderEstimation.order.route.reserveDstToken,
      orderEstimation.requiredReserveAmount,
    )} `,
    `of reserve token (${reserveTokenDesc}) during fulfillment, `,
    `which gives only ${await orderEstimation.order.executor.formatTokenValue(
      orderEstimation.order.orderData.take.chainId,
      orderEstimation.order.route.reserveDstToken,
      orderEstimation.projectedFulfillAmount,
    )} `,
    `of take token (${takeTokenDesc}), `,
    `while order requires ${await orderEstimation.order.executor.formatTokenValue(
      orderEstimation.order.orderData.take.chainId,
      orderEstimation.order.route.reserveDstToken,
      orderEstimation.order.orderData.take.amount,
    )} of take amount `,
    `(${takeAmountDropShare}% drop)`,
  ].join('');
}

type RawOrderEstimation = {
  isProfitable: boolean;

  reserveToken: Uint8Array;

  requiredReserveAmount: bigint;

  projectedFulfillAmount: bigint;
};

export type OrderEstimation = {
  readonly order: CreatedOrder;
  readonly isProfitable: boolean;
  readonly requiredReserveAmount: bigint;
  readonly projectedFulfillAmount: bigint;
  readonly payload: OrderEvaluationPayload;
};

export class OrderEstimator extends OrderEvaluationContextual {
  protected readonly logger: Logger;

  constructor(
    public readonly order: CreatedOrder,
    protected readonly context: OrderEstimatorContext,
  ) {
    super(context.validationPayload);
    this.logger = context.logger.child({ service: OrderEstimator.name });
  }

  private getRouteHint() {
    if (this.order.route.requiresSwap) {
      const routeHint = this.payload.validationPreFulfillSwap;
      assert(
        routeHint !== undefined,
        'missing validationPreFulfillSwap from the validator for route hinting when building final swap txn',
      );
      return routeHint;
    }

    return undefined;
  }

  protected async getExpectedTakeAmountContext(): Promise<
    Parameters<typeof calculateExpectedTakeAmount>['2']
  > {
    return {
      client: this.order.executor.client,
      priceTokenService: this.order.executor.tokenPriceService,
      buckets: this.order.executor.buckets,
      swapConnector: this.order.executor.swapConnector,
      logger: createClientLogger(this.logger),
      batchSize: this.order.giveChain.srcConstraints.batchUnlockSize,
      swapEstimationPreference: this.getRouteHint(),
      isFeatureEnableOpHorizon: process.env.DISABLE_OP_HORIZON_CAMPAIGN !== 'true',
      allowSubsidy: this.order.executor.allowSubsidy,
      subsidizationRules: this.order.executor.subsidizationRules,
    };
  }

  protected async getRawOrderEstimation(): Promise<RawOrderEstimation> {
    const rawEstimation = await calculateExpectedTakeAmount(
      this.order.orderData,
      this.order.legacyRequiredMargin,
      await this.getExpectedTakeAmountContext(),
    );

    return {
      isProfitable: rawEstimation.isProfitable,
      reserveToken: rawEstimation.reserveDstToken,
      requiredReserveAmount: BigInt(rawEstimation.requiredReserveDstAmount),
      projectedFulfillAmount: BigInt(rawEstimation.profitableTakeAmount),
    };
  }

  async getEstimation(): Promise<OrderEstimation> {
    const rawOrderEstimation = await this.getRawOrderEstimation();

    // ensure dln-taker's algo aligns with calculateExpectedTakeAmount behaviour
    assert(
      buffersAreEqual(rawOrderEstimation.reserveToken, this.order.route.reserveDstToken),
      `dln-taker has picked ${this.order.route.reserveDstToken.toAddress(
        this.order.takeChain.chain,
      )} as reserve token, while calculateExpectedTakeAmount returned ${rawOrderEstimation.reserveToken.toAddress(
        this.order.takeChain.chain,
      )}`,
    );

    // provide a swap that would be executed upon fulfillment: this is crucial because this swap may be outdated
    // making estimation not profitable
    let preFulfillSwap;
    if (this.order.route.requiresSwap) {
      preFulfillSwap = await this.order.executor.swapConnector.getSwap(
        {
          amountIn: rawOrderEstimation.requiredReserveAmount,
          chainId: this.order.orderData.take.chainId,
          fromTokenAddress: rawOrderEstimation.reserveToken,
          toTokenAddress: this.order.orderData.take.tokenAddress,
          slippageBps: getPreFulfillSlippage(
            rawOrderEstimation.projectedFulfillAmount,
            this.order.orderData.take.amount,
          ),
          routeHint: this.getRouteHint(),
          fromAddress: this.order.takeChain.fulfillAuthority.bytesAddress,
          destReceiver: this.order.executor.client.getForwarderAddress(
            this.order.orderData.take.chainId,
          ),
        },
        {
          logger: createClientLogger(this.logger),
        },
      );

      rawOrderEstimation.projectedFulfillAmount = preFulfillSwap.amountOut;
      if (preFulfillSwap.amountOut < this.order.orderData.take.amount) {
        rawOrderEstimation.isProfitable = false;
      }

      this.setPayloadEntry('preFulfillSwap', preFulfillSwap);
    }

    return {
      order: this.order,
      isProfitable: rawOrderEstimation.isProfitable,
      requiredReserveAmount: rawOrderEstimation.requiredReserveAmount,
      projectedFulfillAmount: rawOrderEstimation.projectedFulfillAmount,
      payload: this.payload,
    };
  }
}
