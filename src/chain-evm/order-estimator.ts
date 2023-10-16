import { calculateExpectedTakeAmount } from '@debridge-finance/legacy-dln-profitability';
import { OrderEstimator } from 'src/chain-common/order-estimator';
import { EvmProviderAdapter } from 'src/chain-evm/evm.provider.adapter';
import { EVMOrderValidator } from './order-validator';

export class EVMOrderEstimator extends OrderEstimator {
  // Must cover up to 12.5% block base fee increase
  public static readonly EVM_FULFILL_GAS_PRICE_MULTIPLIER = 1.125;

  public static readonly EVM_ESTIMATED_GAS_PRICE_NAME = 'evmEstimatedGasPrice';

  public static readonly EVM_ESTIMATED_FEE_NAME = 'evmEstimatedFee';

  /**
   * Estimate gas price that would be relevant during the next few moments. An order would be estimated against
   * exactly this gas price
   */
  private async getEstimatedGasPrice(): Promise<bigint> {
    const evmAdapter = this.order.takeChain.fulfillProvider as EvmProviderAdapter;
    const currentGasPriceBN = await evmAdapter.getRequiredGasPrice();
    const currentGasPrice = BigInt(currentGasPriceBN.integerValue().toString());
    const estimatedGasPrice =
      (currentGasPrice * BigInt(EVMOrderEstimator.EVM_FULFILL_GAS_PRICE_MULTIPLIER * 10_000)) /
      10_000n;
    this.logger.debug(`estimated gas price for the next block: ${estimatedGasPrice}`);
    this.setPayloadEntry<bigint>(EVMOrderEstimator.EVM_ESTIMATED_GAS_PRICE_NAME, estimatedGasPrice);

    return estimatedGasPrice;
  }

  /**
   * Sets evmFulfillGasLimit and evmFulfillCappedGasPrice for order profitability estimation
   */
  protected async getExpectedTakeAmountContext(): Promise<
    Parameters<typeof calculateExpectedTakeAmount>['2']
  > {
    const gasPrice = await this.getEstimatedGasPrice();
    const gasLimit = this.getPayloadEntry<number>(EVMOrderValidator.EVM_FULFILL_GAS_LIMIT_NAME);
    this.setPayloadEntry(EVMOrderEstimator.EVM_ESTIMATED_FEE_NAME, gasPrice * BigInt(gasLimit));

    const parentContext = await super.getExpectedTakeAmountContext();
    return {
      ...parentContext,
      evmFulfillGasLimit: gasLimit,
      evmFulfillCappedGasPrice: gasPrice,
    };
  }
}
