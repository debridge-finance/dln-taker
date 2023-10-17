import { ChainEngine } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { VersionedTransaction } from '@solana/web3.js';
import { createClientLogger } from '../../dln-ts-client.utils';
import { OrderEstimation } from '../../chain-common/order-estimator';

export async function createOrderFullfillTx(
  estimation: OrderEstimation,
  logger: Logger,
): Promise<VersionedTransaction> {
  const { order } = estimation;
  if (estimation.preFulfillSwapResult) {
    return order.executor.client.preswapAndFulfillOrder<ChainEngine.Solana>(
      {
        order: order.getWithId(),
        taker: order.takeChain.fulfillAuthority.bytesAddress,
        swapResult: estimation.preFulfillSwapResult,
        loggerInstance: createClientLogger(logger),
      },
      {
        unlockAuthority: order.takeChain.unlockAuthority.bytesAddress,
        computeUnitsLimit: 600_000,
        // externalCallRewardBeneficiary: this.order.takeChain.beneficiary,
      },
    );
  }

  return order.executor.client.fulfillOrder<ChainEngine.Solana>(
    {
      order: order.getWithId(),
      loggerInstance: createClientLogger(logger),
    },
    {
      // permit: '0x',
      taker: order.takeChain.fulfillAuthority.bytesAddress,
      unlockAuthority: order.takeChain.unlockAuthority.bytesAddress,
      // externalCallRewardBeneficiary: this.order.takeChain.beneficiary,
    },
  );
}
