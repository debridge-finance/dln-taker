import { ChainEngine, EvmInstruction } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { InputTransaction } from 'src/chain-evm/signer';
import BigNumber from 'bignumber.js';
import { createClientLogger } from '../../dln-ts-client.utils';
import { OrderEstimation } from '../../chain-common/order-estimator';
import { EVMOrderEstimator } from '../order-estimator';
import { assert } from 'src/errors';
import { EVMOrderValidator } from '../order-validator';

async function getLowLevelEvmInstruction(estimation: OrderEstimation, logger: Logger): Promise<EvmInstruction> {
  const { order } = estimation
  if (estimation.preFulfillSwapResult) {
    return order.executor.client.preswapAndFulfillOrder<ChainEngine.EVM>(
      {
        order: order.getWithId(),
        taker: order.takeChain.fulfillAuthority.bytesAddress,
        swapResult: estimation.preFulfillSwapResult,
        loggerInstance: createClientLogger(logger),
      },
      {
        unlockAuthority: order.takeChain.unlockAuthority.bytesAddress,
        externalCallRewardBeneficiary: order.takeChain.unlockBeneficiary,
      },
    );
  }

  return order.executor.client.fulfillOrder<ChainEngine.EVM>(
    {
      order: order.getWithId(),
      loggerInstance: createClientLogger(logger),
    },
    {
      permit: '0x',
      // taker: this.order.takeChain.fulfillProvider.bytesAddress,
      unlockAuthority: order.takeChain.unlockAuthority.bytesAddress,
      externalCallRewardBeneficiary: order.takeChain.unlockBeneficiary,
    },
  );
}

export async function getFulfillTx(estimation: OrderEstimation, logger: Logger): Promise<InputTransaction> {
  const ix = await getLowLevelEvmInstruction(estimation, logger);
  const cappedFee = <bigint | undefined>estimation.payload[EVMOrderEstimator.EVM_ESTIMATED_FEE_NAME];
  assert(
    (
      (typeof cappedFee === "bigint" && cappedFee > 0)
      || (true === estimation.payload[EVMOrderValidator.EVM_FULFILL_DISABLE_TX_CAPPED_FEE_NAME])
    ),
    'evm order fulfill expects either a capped fee or explicitly disabled fee capping'
  )
  const tx = {
    to: ix.to,
    data: ix.data,
    value: ix.value.toString(),
    cappedFee: cappedFee ? new BigNumber(cappedFee.toString()) : undefined
  };

  logger.debug(`Crafted txn: ${JSON.stringify(tx)}`)
  return tx
}