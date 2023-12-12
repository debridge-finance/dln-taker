import { calculateExpectedTakeAmount } from '@debridge-finance/legacy-dln-profitability';
import { OrderEstimator } from '../chain-common/order-estimator';
import { EVMOrderValidator } from './order-validator';
import { EvmChainPreferencesStore } from './preferences/preferences';
import { GasCategory } from './fees/types';

export class EVMOrderEstimator extends OrderEstimator {
  public static readonly PAYLOAD_ENTRY__EVM_ESTIMATED_GAS_PRICE =
    'EVMOrderEstimator.PAYLOAD_ENTRY__EVM_ESTIMATED_GAS_PRICE';

  public static readonly PAYLOAD_ENTRY__EVM_ESTIMATED_FEE =
    'EVMOrderEstimator.PAYLOAD_ENTRY__EVM_ESTIMATED_FEE';

  /**
   * Estimate gas price that would be relevant during the next few moments. An order would be estimated against
   * exactly this gas price
   */
  private async getEstimatedGasPrice(): Promise<bigint> {
    const estimatedNextGasPrice = await EvmChainPreferencesStore.get(
      this.order.takeChain.chain,
    ).feeManager.getGasPrice(GasCategory.PROJECTED);
    this.logger.debug(`estimated gas price for the next block: ${estimatedNextGasPrice}`);
    this.setPayloadEntry(
      EVMOrderEstimator.PAYLOAD_ENTRY__EVM_ESTIMATED_GAS_PRICE,
      estimatedNextGasPrice,
    );

    return estimatedNextGasPrice;
  }

  /**
   * Sets evmFulfillGasLimit and evmFulfillCappedGasPrice for order profitability estimation
   */
  protected async getExpectedTakeAmountContext(): Promise<
    Parameters<typeof calculateExpectedTakeAmount>['2']
  > {
    const gasPrice = await this.getEstimatedGasPrice();
    const gasLimit = this.getPayloadEntry<number>(
      EVMOrderValidator.PAYLOAD_ENTRY__EVM_FULFILL_GAS_LIMIT,
    );
    this.setPayloadEntry(
      EVMOrderEstimator.PAYLOAD_ENTRY__EVM_ESTIMATED_FEE,
      gasPrice * BigInt(gasLimit),
    );

    const parentContext = await super.getExpectedTakeAmountContext();
    return {
      ...parentContext,
      evmFulfillGasLimit: gasLimit,
      evmFulfillCappedGasPrice: gasPrice,
    };
  }
}
