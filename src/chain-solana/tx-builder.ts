import { OrderDataWithId, Solana } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { OrderEstimation } from 'src/chain-common/order-estimator';
import { TransactionBuilder } from 'src/chain-common/tx-builder';
import { IExecutor } from 'src/executor';
import { SolanaTxSigner } from 'src/chain-solana/signer';
import { unlockTx } from './utils/unlock.tx';
import { tryInitTakerALT } from './utils/init-alts.tx';
import { createOrderFullfillTx } from './utils/orderFulfill.tx';

export class SolanaTransactionBuilder implements TransactionBuilder {
  constructor(
    private solanaClient: Solana.DlnClient,
    private readonly signer: SolanaTxSigner,
    private readonly executor: IExecutor,
  ) {}

  getOrderFulfillTxSender(orderEstimation: OrderEstimation, logger: Logger) {
    return async () =>
      this.signer.sendTransaction(await createOrderFullfillTx(orderEstimation, logger), {
        logger,
        options: {},
      });
  }

  getBatchOrderUnlockTxSender(orders: OrderDataWithId[], logger: Logger): () => Promise<string> {
    return async () =>
      this.signer.sendTransaction(await unlockTx(this.executor, orders, logger), {
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
          this.signer.bytesAddress,
          Object.values(this.executor.chains).map((chainConfig) => chainConfig.chain),
          this.signer,
          this.solanaClient,
          logger,
        );

        return [];
      } catch (e) {
        logger.info(`Unable to initialize alts (attempt ${i}/${maxAttempts})`);
        logger.error(e);
      }
    }
    throw new Error('Unable to initialize alts');
  }
}
