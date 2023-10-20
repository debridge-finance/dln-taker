import { ChainId, OrderDataWithId, Solana } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { InitTransactionBuilder } from 'src/processor';
import { FulfillTransactionBuilder } from 'src/chain-common/order-taker';
import { BatchUnlockTransactionBuilder } from 'src/processors/BatchUnlocker';
import { unlockTx } from './utils/unlock.tx';
import { tryInitTakerALT } from './utils/init-alts.tx';
import { createOrderFullfillTx } from './utils/orderFulfill.tx';
import { SolanaTxSigner } from './signer';
import { IExecutor } from '../executor';
import { OrderEstimation } from '../chain-common/order-estimator';

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
          this.executor.getSupportedChain(ChainId.Solana).fulfillAuthority.bytesAddress,
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
