import { ChainEngine } from "@debridge-finance/dln-client";
import { Logger } from "pino";
import { createClientLogger } from "../logger";
import { CreatedOrder } from "../chain-common/order";
import { OrderEstimation } from "../chain-common/order-estimator";

export class SolanaOrderFulfillIntent {
  readonly #logger: Logger;
  constructor(
      private order: CreatedOrder, private estimation: OrderEstimation, logger: Logger
  ) {
      this.#logger = logger.child({ service: SolanaOrderFulfillIntent.name })
  }

  async createOrderFullfillTx() {
      if (this.estimation.preFulfillSwapResult) {
        return this.order.executor.client.preswapAndFulfillOrder<ChainEngine.Solana>(
          {
            order: this.order.getWithId(),
            taker: this.order.takeChain.fulfillProvider.bytesAddress,
            swapResult: this.estimation.preFulfillSwapResult,
            loggerInstance: createClientLogger(this.#logger),
          },
          {
            unlockAuthority: this.order.takeChain.unlockProvider.bytesAddress,
            computeUnitsLimit: 600_000,
            // externalCallRewardBeneficiary: this.order.takeChain.beneficiary,
          },
        );
      }

      return this.order.executor.client.fulfillOrder<ChainEngine.Solana>(
        {
          order: this.order.getWithId(),
          loggerInstance: createClientLogger(this.#logger),
        },
        {
          // permit: '0x',
          taker: this.order.takeChain.fulfillProvider.bytesAddress,
          unlockAuthority: this.order.takeChain.unlockProvider.bytesAddress,
          // externalCallRewardBeneficiary: this.order.takeChain.beneficiary,
        },
      )
    }
}
