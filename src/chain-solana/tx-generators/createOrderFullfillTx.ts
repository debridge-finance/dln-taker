import { ChainEngine } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { VersionedTransaction } from '@solana/web3.js';
import { createClientLogger } from '../../dln-ts-client.utils';
import { OrderEstimation } from '../../chain-common/order-estimator';
import { assert } from '../../errors';

export async function createOrderFullfillTx(
  estimation: OrderEstimation,
  logger: Logger,
): Promise<VersionedTransaction> {
  const { order } = estimation;
  if (estimation.order.route.requiresSwap) {
    const swapResult = estimation.payload.preFulfillSwap;
    assert(swapResult !== undefined, 'missing preFulfillSwap payload entry');

    return order.executor.client.preswapAndFulfillOrder<ChainEngine.Solana>(
      {
        order: order.getWithId(),
        taker: order.takeChain.fulfillAuthority.bytesAddress,
        swapResult,
        loggerInstance: createClientLogger(logger),
      },
      {
        unlockAuthority: order.takeChain.unlockAuthority.bytesAddress,
        computeUnitsLimit: 600_000,
      },
    );
  }

  return order.executor.client.fulfillOrder<ChainEngine.Solana>(
    {
      order: order.getWithId(),
      loggerInstance: createClientLogger(logger),
    },
    {
      taker: order.takeChain.fulfillAuthority.bytesAddress,
      unlockAuthority: order.takeChain.unlockAuthority.bytesAddress,
    },
  );
}
