import { PostponingReason } from "src/hooks/HookEnums";
import { OrderValidator, postponeOrder } from "src/chain-common/order-validator";
import { EvmProviderAdapter } from "src/chain-evm/evm.provider.adapter";
import { EVMOrderFulfillIntent } from "./order-fulfill";
import { EVMOrderEstimator } from "./order-estimator";

export class EVMOrderValidator extends OrderValidator {
    public static readonly EVM_FULFILL_GAS_LIMIT_NAME = 'evmFulfillGasLimit'

    protected async runChecks() {
        super.runChecks()
        await this.checkEvmEstimation();
    }

    private async checkEvmEstimation(): Promise<void> {
        const intent = new EVMOrderFulfillIntent(
            this.order,
            {
                order: this.order,
                isProfitable: true,
                requiredReserveAmount: await this.order.getMaxProfitableReserveAmount(),
                projectedFulfillAmount: this.order.orderData.take.amount,
                preFulfillSwapResult: this.preliminarySwapResult,
                payload: {}
            },
            this.logger
        );

        const adapter = this.order.takeChain.fulfillProvider as EvmProviderAdapter;
        const tx = await intent.createOrderFullfillTx();
        try {
            const evmFulfillGasLimit = await adapter.estimateGas({
                to: tx.to,
                data: tx.data,
                value: tx.value?.toString(),
            });
            this.logger.debug(
                `estimated gas needed for the fulfill tx with roughly estimated reserve amount: ${evmFulfillGasLimit} gas units`,
            );
            this.setPayloadEntry<number>(EVMOrderValidator.EVM_FULFILL_GAS_LIMIT_NAME, evmFulfillGasLimit);
        }
        catch (e) {
            return postponeOrder(PostponingReason.NOT_PROFITABLE, 'unable to estimate preliminary txn')
        }
    }

    protected getOrderEstimator() {
        return new EVMOrderEstimator(this.order, { logger: this.logger, preferEstimation: this.preliminarySwapResult, validationPayload: this.payload })
    }
}