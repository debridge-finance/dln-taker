import { Connection, PublicKey } from '@solana/web3.js';
import { helpers } from '@debridge-finance/solana-utils';
import { ChainId, Solana } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { SolanaTxSigner } from '../signer';

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
  takerAddress: Uint8Array,
  chains: ChainId[],
  solanaAdapter: SolanaTxSigner,
  solanaClient: Solana.DlnClient,
  logger: Logger,
) {
  // WARN: initForTaket requires explicit payer (tx signer) and actual taker addresses
  // On MPC feat activation initForTaker payer will be = helper wallet and taker = mpc address
  const maybeTxs = await solanaClient.initForTaker(
    new PublicKey(solanaAdapter.bytesAddress),
    new PublicKey(takerAddress),
    chains,
  );
  if (!maybeTxs) {
    logger.info(
      `ALT already initialized or was found: ${solanaClient.fulfillPreswapALT!.toBase58()}`,
    );

    return;
  }

  const solanaConnection = solanaClient.getConnection(ChainId.Solana);
  const [initTx, ...restTxs] = maybeTxs;
  // initALT ix may yield errors like recentSlot is too old/broken blockhash, it's better to add retries
  const initTxId = await solanaAdapter.sendTransaction(initTx, {
    logger,
    options: {
      convertIntoTxV0: false,
      blockhashCommitment: 'confirmed',
    },
  });
  logger.info(`Initialized ALT: ${initTxId}`);

  await waitSolanaTxFinalized(solanaConnection, initTxId);
  const txWithFreeze = restTxs.pop();
  if (restTxs.length !== 0) {
    const fillIds = await solanaAdapter.sendTransactions(restTxs, {
      logger,
      options: {
        convertIntoTxV0: false,
        blockhashCommitment: 'confirmed',
      },
    });
    await Promise.all(fillIds.map((txId) => waitSolanaTxFinalized(solanaConnection, txId)));
    logger.info(`Fill ALT: ${fillIds.join(', ')}`);
  }
  if (txWithFreeze) {
    const freezeId = await solanaAdapter.sendTransaction(txWithFreeze, {
      logger,
      options: {
        convertIntoTxV0: false,
        blockhashCommitment: 'confirmed',
      },
    });
    logger.info(`Freezed ALT: ${freezeId}`);
  }
}
