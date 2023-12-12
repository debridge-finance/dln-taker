import { PostponingReason } from '../hooks/HookEnums';
import { OrderValidator } from '../chain-common/order-validator';
import { EVMOrderEstimator } from './order-estimator';
import { createOrderFullfillTx } from './tx-generators/createOrderFullfillTx';
import { InputTransaction } from './signer';
import { EvmChainPreferencesStore } from './preferences/store';

export class EVMOrderValidator extends OrderValidator {
  public static readonly PAYLOAD_ENTRY__EVM_FULFILL_GAS_LIMIT =
    'EVMOrderValidator.PAYLOAD_ENTRY__EVM_FULFILL_GAS_LIMIT';

  public static readonly PAYLOAD_ENTRY__EVM_FULFILL_DISABLE_TX_CAPPED_FEE =
    'EVMOrderValidator,PAYLAOD_ENTRY__EVM_FULFILL_DISABLE_TX_CAPPED_FEE';

  protected async runChecks() {
    await super.runChecks();
    await this.checkEvmEstimation();
  }

  protected get logger() {
    return super.logger.child({ service: EVMOrderValidator.name });
  }

  private async checkEvmEstimation(): Promise<void> {
    const tx = await createOrderFullfillTx(
      {
        order: this.order,
        isProfitable: true,
        requiredReserveAmount:
          await this.order.getMaxProfitableReserveAmountWithoutOperatingExpenses(),
        projectedFulfillAmount: this.order.orderData.take.amount,
        payload: {
          preFulfillSwap: this.payload.validationPreFulfillSwap,
          [EVMOrderValidator.PAYLOAD_ENTRY__EVM_FULFILL_DISABLE_TX_CAPPED_FEE]: true,
        },
      },
      this.logger.child({ routine: 'checkEvmEstimation' }),
    );

    try {
      const gasLimit = await this.estimateTx(tx);
      this.setPayloadEntry(EVMOrderValidator.PAYLOAD_ENTRY__EVM_FULFILL_GAS_LIMIT, gasLimit);
      this.logger.debug(
        `estimated gas needed for the fulfill tx with roughly estimated reserve amount: ${gasLimit} gas units`,
      );
    } catch (e) {
      return this.sc.postpone(
        PostponingReason.FULFILLMENT_EVM_TX_PREESTIMATION_FAILED,
        `unable to estimate preliminary txn: ${e}`,
      );
    }

    return Promise.resolve();
  }

  private async estimateTx(tx: InputTransaction): Promise<number> {
    return EvmChainPreferencesStore.get(this.order.takeChain.chain).feeManager.estimateTx(
      {
        to: tx.to,
        data: tx.data,
        value: tx.value?.toString(),
        from: this.order.takeChain.fulfillAuthority.address,
      },
      { logger: this.logger },
    );
  }

  protected getOrderEstimator() {
    return new EVMOrderEstimator(this.order, {
      logger: this.logger,
      validationPayload: this.payload,
    });
  }
}
