
import { ChainEngine } from "@debridge-finance/dln-client";
import { Logger } from "pino";
import { createClientLogger } from "../logger";
import { CreatedOrder } from "../chain-common/order";
import { OrderEstimation } from "../chain-common/order-estimator";

export class EVMOrderFulfillIntent {
    readonly #logger: Logger;
    constructor(
        private order: CreatedOrder, private estimation: OrderEstimation, logger: Logger
    ) {
        this.#logger = logger.child({ service: EVMOrderFulfillIntent.name })
    }

    async createOrderFullfillTx() {
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
