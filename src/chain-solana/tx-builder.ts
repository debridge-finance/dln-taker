import { ChainId, OrderDataWithId, Solana } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { setTimeout } from 'timers/promises';
import { createBatchOrderUnlockTx } from './tx-generators/createBatchOrderUnlockTx';
import { tryInitTakerALT } from './tx-generators/tryInitTakerALT';
import { createOrderFullfillTx } from './tx-generators/createOrderFullfillTx';
import { SolanaTxSigner } from './signer';
import { IExecutor } from '../executor';
import { OrderEstimation } from '../chain-common/order-estimator';
import { InitTransactionBuilder } from '../processor';
import { FulfillTransactionBuilder } from '../chain-common/order-taker';
import { BatchUnlockTransactionBuilder } from '../processors/BatchUnlocker';

export class SolanaTransactionBuilder
  implements InitTransactionBuilder, FulfillTransactionBuilder, BatchUnlockTransactionBuilder
{
  constructor(
    private solanaClient: Solana.DlnClient,
    private readonly signer: SolanaTxSigner,
    private readonly executor: IExecutor,
  ) {}

  get fulfillAuthority() {
    return {
      address: this.signer.address,
      bytesAddress: this.signer.bytesAddress,
    };
  }

  get unlockAuthority() {
    return {
      address: this.signer.address,
      bytesAddress: this.signer.bytesAddress,
    };
  }

  getOrderFulfillTxSender(orderEstimation: OrderEstimation, logger: Logger) {
    return async () =>
      this.signer.sendTransaction(await createOrderFullfillTx(orderEstimation, logger), {
        logger,
        options: {},
      });
  }

  getBatchOrderUnlockTxSender(orders: OrderDataWithId[], logger: Logger): () => Promise<string> {
    return async () =>
      this.signer.sendTransaction(await createBatchOrderUnlockTx(this.executor, orders, logger), {
        logger,
        options: {},
      });
  }

  async getInitTxSenders(logger: Logger) {
    logger.debug('initialize solanaClient.destination.debridge...');
    await this.solanaClient.destination.debridge.init();

    const maxAttempts = 5;
    for (let i = 0; i < maxAttempts; i += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
        await tryInitTakerALT(
          this.executor.getSupportedChain(ChainId.Solana).fulfillAuthority.bytesAddress,
          Object.values(this.executor.chains).map((chainConfig) => chainConfig.chain),
          this.signer,
          this.solanaClient,
          logger,
        );

        return [];
      } catch (e) {
        const attempt = i + 1;
        logger.info(`Unable to initialize alts (attempt ${attempt}/${maxAttempts})`);
        if (attempt === maxAttempts) logger.error(e);
        // sleep for 2s
        // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
        await setTimeout(2000);
      }
    }

    throw new Error('Unable to initialize alts, restart the taker');
  }
}
