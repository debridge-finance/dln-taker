import {
  OrderData,
  OrderDataWithId,
  Order as OrderUtils,
  buffersAreEqual,
  getEngineByChainId,
  ChainEngine,
  ChainId,
} from '@debridge-finance/dln-client';
import {
  calculateSubsidization,
  findExpectedBucket,
} from '@debridge-finance/legacy-dln-profitability';
import { helpers } from '@debridge-finance/solana-utils';
import { Logger } from 'pino';
import { EVMOrderValidator } from '../chain-evm/order-validator';
import { createClientLogger } from '../dln-ts-client.utils';
import {
  IExecutor,
  ExecutorSupportedChain,
  SrcConstraintsPerOrderValue,
  SrcOrderConstraints,
  DstOrderConstraints,
  DstConstraintsPerOrderValue,
} from '../executor';
import { OrderId } from '../interfaces';
import { CreatedOrderTaker, TakerShortCircuit } from './order-taker';
import { OrderValidator } from './order-validator';

type CreatedOrderContext = {
  executor: IExecutor;
  giveChain: ExecutorSupportedChain;
  takeChain: ExecutorSupportedChain;
  logger: Logger;
};

export class CreatedOrder {
  public readonly executor: IExecutor;

  public readonly giveChain: ExecutorSupportedChain;

  public readonly takeChain: ExecutorSupportedChain;

  readonly #logger: Logger;

  async getUsdValue(): Promise<number> {
    const value = await this.executor.usdValueOfOrder(this.orderData);
    // round up to 2 decimals
    return Math.round(value * 100) / 100;
  }

  get giveTokenAsString(): string {
    return this.orderData.give.tokenAddress.toAddress(this.orderData.give.chainId);
  }

  get takeTokenAsString(): string {
    return this.orderData.give.tokenAddress.toAddress(this.orderData.give.chainId);
  }

  get route() {
    const route = findExpectedBucket(this.orderData, this.executor.buckets);
    return {
      ...route,
      requiresSwap:
        buffersAreEqual(route.reserveDstToken, this.orderData.take.tokenAddress) === false,
    };
  }

  constructor(
    public readonly orderId: OrderId,
    public readonly orderData: OrderData,
    public readonly finalization: 'Finalized' | number,
    public readonly arrivedAt: Date,
    public readonly attempt: number,
    context: CreatedOrderContext,
  ) {
    this.executor = context.executor;
    this.giveChain = context.giveChain;
    this.takeChain = context.takeChain;
    this.#logger = context.logger.child({ orderId });
  }

  async getGiveAmountInReserveToken(): Promise<bigint> {
    return this.executor.resyncDecimals(
      this.orderData.give.chainId,
      this.orderData.give.tokenAddress,
      this.orderData.give.amount,
      this.orderData.take.chainId,
      this.route.reserveDstToken,
    );
  }

  async getMaxProfitableReserveAmountWithoutOperatingExpenses(): Promise<bigint> {
    // getting the rough amount we are willing to spend after reserving our intended margin
    let reserveDstAmount = await this.getGiveAmountInReserveToken();

    // subtracting margin
    reserveDstAmount = (reserveDstAmount * (10_000n - BigInt(this.requiredMargin))) / 10_000n;

    // adding subsidy
    if (this.executor.allowSubsidy && this.executor.subsidizationRules) {
      const subsidyAmount = await calculateSubsidization(
        {
          order: this.orderData,
          reserveDstTokenAddress: this.route.reserveDstToken,
        },
        {
          client: this.executor.client,
          priceTokenService: this.executor.tokenPriceService,
          subsidizationRules: this.executor.subsidizationRules,
          logger: createClientLogger(this.#logger),
        },
      );

      reserveDstAmount += subsidyAmount;
    }

    return reserveDstAmount;
  }

  get blockConfirmations(): number {
    if (this.finalization === 'Finalized') return this.giveChain.network.finalizedBlockCount;
    return this.finalization;
  }

  /**
   * Returns margin requirement for this particular order. It may take give- and take-chain into consideration
   */
  get requiredMargin(): number {
    let margin = this.legacyRequiredMargin;

    if (process.env.DISABLE_OP_HORIZON_CAMPAIGN !== 'true') {
      if (this.takeChain.chain === ChainId.Optimism) {
        margin -= 4;
      } else if (this.giveChain.chain === ChainId.Optimism) {
        margin -= 2;
      }

      if (margin < 0) margin = 0;
    }

    return margin;
  }

  /**
   * Similar to `requiredMargin`, but used by the legacy-dln-profitability package. The difference between
   * requiredMargin and legacyRequiredMargin is that the latter does not account for OP HORIZON Campaign rebates
   * bc legacy-dln-profitability does this internally
   */
  get legacyRequiredMargin(): number {
    return this.giveChain.srcConstraints.profitability;
  }

  public srcConstraints(): SrcOrderConstraints {
    return this.srcConstraintsRange() || this.giveChain.srcConstraints;
  }

  public srcConstraintsRange(): SrcConstraintsPerOrderValue | undefined {
    return this.giveChain.srcConstraints.perOrderValue
      .sort((rangeB, rangeA) => rangeA.minBlockConfirmations - rangeB.minBlockConfirmations)
      .find((range) => range.minBlockConfirmations <= this.blockConfirmations);
  }

  public dstConstraints(): DstOrderConstraints {
    return this.dstConstraintsRange() || this.takeChain.dstConstraints;
  }

  private dstConstraintsRange(): DstConstraintsPerOrderValue | undefined {
    return this.takeChain.dstConstraints.perOrderValue
      .sort((rangeB, rangeA) => rangeA.minBlockConfirmations - rangeB.minBlockConfirmations)
      .find((range) => range.minBlockConfirmations <= this.blockConfirmations);
  }

  getValidator(sc: TakerShortCircuit): OrderValidator {
    switch (getEngineByChainId(this.takeChain.chain)) {
      case ChainEngine.EVM:
        return new EVMOrderValidator(this, sc, { logger: this.#logger });
      default:
        return new OrderValidator(this, sc, { logger: this.#logger });
    }
  }

  getWithId(): OrderDataWithId {
    return OrderUtils.getVerified({
      orderId: helpers.hexToBuffer(this.orderId),
      ...this.orderData,
    });
  }

  getTaker() {
    return new CreatedOrderTaker(this, this.#logger);
  }
}
