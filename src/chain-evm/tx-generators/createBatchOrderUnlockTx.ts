import {
  ChainEngine,
  ChainId,
  OrderDataWithId,
  OrderEstimationStage,
} from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { assert } from '../../errors';
import { IExecutor } from '../../executor';
import { createClientLogger } from '../../dln-ts-client.utils';
import { InputTransaction } from '../signer';

export async function createBatchOrderUnlockTx(
  executor: IExecutor,
  orders: Array<OrderDataWithId>,
  logger: Logger,
): Promise<InputTransaction> {
  assert(orders.length > 0, 'empty array of orders given for batch unlock');

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

  const extraPayload =
    giveChain.chain === ChainId.Solana
      ? {
          solanaInitWalletReward: fees.rewards[0],
          solanaClaimUnlockReward: fees.rewards[1],
        }
      : {};

  const tx = await executor.client.sendBatchUnlock<ChainEngine.EVM>(
    {
      beneficiary: giveChain.unlockBeneficiary,
      executionFee: fees.total,
      loggerInstance: createClientLogger(logger),
      orders,
    },
    extraPayload,
  );
  return {
    to: tx.to,
    data: tx.data,
    value: tx.value?.toString() || undefined,
  };
}
