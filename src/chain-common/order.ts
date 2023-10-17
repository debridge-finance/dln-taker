import {
  OrderData,
  OrderDataWithId,
  Order as OrderUtils,
  buffersAreEqual,
  getEngineByChainId,
  ChainEngine,
} from '@debridge-finance/dln-client';
import { findExpectedBucket } from '@debridge-finance/legacy-dln-profitability';
import { helpers } from '@debridge-finance/solana-utils';
import { Logger } from 'pino';
import { EVMOrderValidator } from 'src/chain-evm/order-validator';
import { BLOCK_CONFIRMATIONS_HARD_CAPS, SupportedChain } from '../config';
import {
  IExecutor,
  ExecutorSupportedChain,
  SrcConstraintsPerOrderValue,
  SrcOrderConstraints,
  DstOrderConstraints,
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
      requiresSwap: false === buffersAreEqual(route.reserveDstToken, this.orderData.take.tokenAddress),
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

  async getMaxProfitableReserveAmount(): Promise<bigint> {
    // getting the rough amount we are willing to spend after reserving our intended margin
    const margin = BigInt(this.giveChain.srcConstraints.profitability);
    const reserveDstAmount = await this.getGiveAmountInReserveToken();
    const amount = (reserveDstAmount * (10_000n - margin)) / 10_000n;
    return amount;
  }

  get blockConfirmations(): number {
    if (this.finalization === 'Finalized')
      return BLOCK_CONFIRMATIONS_HARD_CAPS[this.giveChain.chain as unknown as SupportedChain];
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
    const dstConstraintsByValue = this.takeChain.dstConstraints.perOrderValue.find(
      (dstConstraints) => usdValue <= dstConstraints.upperThreshold,
    );

    return dstConstraintsByValue || this.takeChain.dstConstraints;
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
    return new CreatedOrderTaker(this, this.#logger)
  }
}