import Web3 from 'web3';
import { PostponingReason } from '../hooks/HookEnums';
import { OrderValidator } from '../chain-common/order-validator';
import { EVMOrderEstimator } from './order-estimator';
import { getFulfillTx } from './utils/orderFulfill.tx';
import { EVM_GAS_LIMIT_MULTIPLIER, InputTransaction } from './signer';

export class EVMOrderValidator extends OrderValidator {
  public static readonly EVM_FULFILL_GAS_LIMIT_NAME = 'evmFulfillGasLimit';

  /**
   * Reasonable multiplier for gas obtained from the estimateGas() RPC call, because sometimes there are cases when
   * tx fails being out of gas (esp on Avalanche).
   * Must be in sync with EVMOrderEstimator.EVM_FULFILL_GAS_PRICE_MULTIPLIER because it directly affects order
   * profitability
   */
  public static readonly EVM_FULFILL_GAS_LIMIT_MULTIPLIER = EVM_GAS_LIMIT_MULTIPLIER;

  public static readonly EVM_FULFILL_DISABLE_TX_CAPPED_FEE_NAME =
    'EVM_FULFILL_DISABLE_TX_CAPPED_FEE_NAME';

  protected async runChecks() {
    await super.runChecks();
    await this.checkEvmEstimation();
  }

  protected get logger() {
    return super.logger.child({ service: EVMOrderValidator.name });
  }

  private async checkEvmEstimation(): Promise<void> {
    const tx = await getFulfillTx(
      {
        order: this.order,
        isProfitable: true,
        requiredReserveAmount: await this.order.getMaxProfitableReserveAmount(),
        projectedFulfillAmount: this.order.orderData.take.amount,
        preFulfillSwapResult: this.preliminarySwapResult,
        payload: {
          [EVMOrderValidator.EVM_FULFILL_DISABLE_TX_CAPPED_FEE_NAME]: true,
        },
      },
      this.logger.child({ routine: 'checkEvmEstimation' }),
    );

    try {
      const gasLimit = await this.estimateTx(tx);
      this.logger.debug(
        `estimated gas needed for the fulfill tx with roughly estimated reserve amount: ${gasLimit} gas units`,
      );
      this.setPayloadEntry<number>(EVMOrderValidator.EVM_FULFILL_GAS_LIMIT_NAME, gasLimit);
    } catch (e) {
      return this.sc.postpone(
        PostponingReason.FULFILLMENT_EVM_TX_PREESTIMATION_FAILED,
        `unable to estimate preliminary txn: ${e}`,
      );
    }

    return Promise.resolve();
  }

  private async estimateTx(tx: InputTransaction): Promise<number> {
    const takeChainRpc = this.order.takeChain.connection as Web3;
    const gas = await takeChainRpc.eth.estimateGas({
      to: tx.to,
      data: tx.data,
      value: tx.value?.toString(),
      from: this.order.takeChain.fulfillAuthority.address,
    });
    const gasLimit = Math.round(gas * EVMOrderValidator.EVM_FULFILL_GAS_LIMIT_MULTIPLIER);
    return gasLimit;
  }

  protected getOrderEstimator() {
    return new EVMOrderEstimator(this.order, {
      logger: this.logger,
      preSwapRouteHint: this.preliminarySwapResult,
      validationPayload: this.payload,
    });
  }
}
