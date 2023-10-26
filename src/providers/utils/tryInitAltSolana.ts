import { Connection } from '@solana/web3.js';
import { helpers } from '@debridge-finance/solana-utils';
import { ChainId, Solana } from '@debridge-finance/dln-client';
import { Logger } from 'pino';

async function waitSolanaTxFinalized(connection: Connection, txId: string) {
  let finalized = false;
  while (!finalized) {
    // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
    const result = await connection.getTransaction(txId, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 1,
    });
    if (result !== null) {
      finalized = true;
      break;
    }
    // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
    await helpers.sleep(1000);
  }
}

export async function tryInitTakerALT(
  wallet: helpers.Wallet,
  chains: ChainId[],
  solanaClient: Solana.DlnClient,
  logger: Logger,
  retries = 5,
) {
  for (let i = 0; i < retries; i += 1) {
    // WARN: initForTaket requires explicit payer (tx signer) and actual taker addresses
    // On MPC feat activation initForTaker payer will be = helper wallet and taker = mpc address
    // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
    const maybeTxs = await solanaClient.initForTaker(wallet.publicKey, wallet.publicKey, chains);
    if (!maybeTxs) {
      logger.info(
        `ALT already initialized or was found: ${solanaClient.fulfillPreswapALT!.toBase58()}`,
      );

      return;
    }

    const solanaConnection = solanaClient.getConnection(ChainId.Solana);
    try {
      const [initTx, ...restTxs] = maybeTxs;
      // initALT ix may yield errors like recentSlot is too old/broken blockhash, it's better to add retries
      // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
      const [initTxId] = await helpers.sendAll(solanaConnection, wallet, initTx, {
        convertIntoTxV0: false,
        blockhashCommitment: 'confirmed',
      });
      logger.info(`Initialized ALT: ${initTxId}`);

      // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
      await waitSolanaTxFinalized(solanaConnection, initTxId);
      const txWithFreeze = restTxs.pop();
      if (restTxs.length !== 0) {
        // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
        const fillIds = await helpers.sendAll(solanaConnection, wallet, restTxs, {
          convertIntoTxV0: false,
          blockhashCommitment: 'confirmed',
        });
        // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
        await Promise.all(fillIds.map((txId) => waitSolanaTxFinalized(solanaConnection, txId)));
        logger.info(`Fill ALT: ${fillIds.join(', ')}`);
      }
      if (txWithFreeze) {
        // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
        const [freezeId] = await helpers.sendAll(solanaConnection, wallet, txWithFreeze, {
          convertIntoTxV0: false,
          blockhashCommitment: 'confirmed',
        });
        logger.info(`Freezed ALT: ${freezeId}`);
      }

      return;
    } catch (e) {
      logger.error(e);
    }
  }
  throw new Error('Failed to init ALT');
}
