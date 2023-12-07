import { constants } from '@debridge-finance/solana-utils';
import { VersionedTransaction } from '@solana/web3.js';

export function isTxSizeValid(tx: VersionedTransaction): boolean {
  try {
    const copy = new VersionedTransaction(tx.message, tx.signatures);
    copy.message.recentBlockhash = constants.FAKE_BLOCKHASH;
    return copy.serialize().length <= constants.MAX_TX_SIZE;
  } catch {
    return false;
  }
}
