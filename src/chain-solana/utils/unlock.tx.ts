import { ChainEngine, OrderDataWithId, OrderEstimationStage } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { assert } from 'src/errors';
import { IExecutor } from 'src/executor';
import { createClientLogger } from 'src/dln-ts-client.utils';

export async function unlockTx(
  executor: IExecutor,
  orders: Array<OrderDataWithId>,
  logger: Logger,
) {
  assert(orders.length > 0, '');
  const order = orders[0];
  const giveChain = executor.getSupportedChain(order.give.chainId);
  const takeChain = executor.getSupportedChain(order.take.chainId);

  const [giveNativePrice, takeNativePrice] = await Promise.all([
    executor.tokenPriceService.getPrice(giveChain.chain, null, {
      logger: createClientLogger(logger),
    }),
    executor.tokenPriceService.getPrice(takeChain.chain, null, {
      logger: createClientLogger(logger),
    }),
  ]);

  const fees = await executor.client.getClaimExecutionFee(
    {
      action: 'ClaimBatchUnlock',
      giveChain: giveChain.chain,
      giveNativePrice,
      takeChain: takeChain.chain,
      takeNativePrice,
      batchSize: orders.length,
      loggerInstance: createClientLogger(logger),
    },
    {
      orderEstimationStage: OrderEstimationStage.OrderFulfillment,
    },
  );

  return executor.client.sendBatchUnlock<ChainEngine.Solana>(
    {
      beneficiary: giveChain.unlockBeneficiary,
      executionFee: fees.total,
      loggerInstance: createClientLogger(logger),
      orders,
    },
    {
      // solanaInitWalletReward: fees.rewards[0],
      // solanaClaimUnlockReward: fees.rewards[1],
      unlocker: takeChain.unlockAuthority.bytesAddress,
    },
  );
}