import Web3 from 'web3';
import { PostponingReason } from '../hooks/HookEnums';
import { OrderValidator } from '../chain-common/order-validator';
import { EVMOrderEstimator } from './order-estimator';
import { getFulfillTx } from './utils/orderFulfill.tx';

export class EVMOrderValidator extends OrderValidator {
  public static readonly EVM_FULFILL_GAS_LIMIT_NAME = 'evmFulfillGasLimit';

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

    const takeChainRpc = this.order.takeChain.connection as Web3;
    try {
      const evmFulfillGasLimit = await takeChainRpc.eth.estimateGas({
        to: tx.to,
        data: tx.data,
        value: tx.value?.toString(),
        from: this.order.takeChain.fulfillAuthority.address,
      });
      this.logger.debug(
        `estimated gas needed for the fulfill tx with roughly estimated reserve amount: ${evmFulfillGasLimit} gas units`,
      );
      this.setPayloadEntry<number>(
        EVMOrderValidator.EVM_FULFILL_GAS_LIMIT_NAME,
        evmFulfillGasLimit,
      );
    } catch (e) {
      return this.sc.postpone(
        PostponingReason.FULFILLMENT_EVM_TX_PREESTIMATION_FAILED,
        `unable to estimate preliminary txn: ${e}`,
      );
    }

    return Promise.resolve();
  }

  protected getOrderEstimator() {
    return new EVMOrderEstimator(this.order, {
      logger: this.logger,
      preSwapRouteHint: this.preliminarySwapResult,
      validationPayload: this.payload,
    });
  }
}
