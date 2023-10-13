
import { ChainEngine, EvmInstruction } from "@debridge-finance/dln-client";
import { Logger } from "pino";
import { createClientLogger } from "../dln-ts-client.utils";
import { CreatedOrder } from "../chain-common/order";
import { OrderEstimation } from "../chain-common/order-estimator";
import { InputTransaction } from "src/chain-evm/evm.provider.adapter";
import { EVMOrderEstimator } from "./order-estimator";
import { assert } from "console";
import BigNumber from "bignumber.js";

export class EVMOrderFulfillIntent {
    readonly #logger: Logger;
    constructor(
        private order: CreatedOrder, private estimation: OrderEstimation, logger: Logger
    ) {
        this.#logger = logger.child({ service: EVMOrderFulfillIntent.name })
    }

    async createOrderFullfillTx(): Promise<InputTransaction> {
      const tx = await this._createOrderFullfillTx();
      const cappedFee = <bigint>this.estimation.payload[EVMOrderEstimator.EVM_ESTIMATED_FEE_NAME];
      assert(typeof cappedFee === 'bigint', 'capped fee not provided by EVMOrderEstimator')
      return {
        to: tx.to,
        data: tx.data,
        value: tx.value.toString(),
        cappedFee: new BigNumber(cappedFee.toString()),
      }
    }

    async _createOrderFullfillTx(): Promise<EvmInstruction> {
        if (this.estimation.preFulfillSwapResult) {
          return this.order.executor.client.preswapAndFulfillOrder<ChainEngine.EVM>(
            {
              order: this.order.getWithId(),
              taker: this.order.takeChain.fulfillProvider.bytesAddress,
              swapResult: this.estimation.preFulfillSwapResult,
              loggerInstance: createClientLogger(this.#logger),
            },
            {
              unlockAuthority: this.order.takeChain.unlockProvider.bytesAddress,
              externalCallRewardBeneficiary: this.order.takeChain.beneficiary,
            },
          );
        }

        return this.order.executor.client.fulfillOrder<ChainEngine.EVM>(
          {
            order: this.order.getWithId(),
            loggerInstance: createClientLogger(this.#logger),
          },
          {
            permit: '0x',
            // taker: this.order.takeChain.fulfillProvider.bytesAddress,
            unlockAuthority: this.order.takeChain.unlockProvider.bytesAddress,
            externalCallRewardBeneficiary: this.order.takeChain.beneficiary,
          },
        )
      }
  }
