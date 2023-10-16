import { ChainEngine } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { VersionedTransaction } from '@solana/web3.js';
import { createClientLogger } from '../dln-ts-client.utils';
import { CreatedOrder } from '../chain-common/order';
import { OrderEstimation } from '../chain-common/order-estimator';

export class SolanaOrderFulfillIntent {
  readonly #logger: Logger;

  constructor(
    private order: CreatedOrder,
    private estimation: OrderEstimation,
    logger: Logger,
  ) {
    this.#logger = logger.child({ service: SolanaOrderFulfillIntent.name });
  }

  async createOrderFullfillTx(): Promise<VersionedTransaction> {
    if (this.estimation.preFulfillSwapResult) {
      return this.order.executor.client.preswapAndFulfillOrder<ChainEngine.Solana>(
        {
          order: this.order.getWithId(),
          taker: this.order.takeChain.fulfillAuthority.bytesAddress,
          swapResult: this.estimation.preFulfillSwapResult,
          loggerInstance: createClientLogger(this.#logger),
        },
        {
          unlockAuthority: this.order.takeChain.unlockAuthority.bytesAddress,
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
        taker: this.order.takeChain.fulfillAuthority.bytesAddress,
        unlockAuthority: this.order.takeChain.unlockAuthority.bytesAddress,
        // externalCallRewardBeneficiary: this.order.takeChain.beneficiary,
      },
    );
  }
}
