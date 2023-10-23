import { VersionedTransaction, MessageV0 } from '@solana/web3.js';
import { CreateSolanaRawTransactionRequest } from '../authority-forDefi/types/createTransaction';

export function fordefiConvert(
  tx: VersionedTransaction,
  note: string,
  vault_id: string,
): CreateSolanaRawTransactionRequest {
  const message = tx.message as MessageV0;
  const req: CreateSolanaRawTransactionRequest = {
    vault_id,
    note,
    signer_type: 'api_signer',
    type: 'solana_transaction',
    details: {
      type: 'solana_raw_transaction',
      chain: 'solana_mainnet',
      version: 'v0',
      instructions: message.compiledInstructions.map((ci) => ({
        account_indexes: ci.accountKeyIndexes,
        data: Buffer.from(ci.data).toString('base64'),
        program_index: ci.programIdIndex,
      })),
      accounts: message.staticAccountKeys.map((acc, idx) => ({
        address: acc.toBase58(),
        signer: message.isAccountSigner(idx),
        writable: message.isAccountWritable(idx),
      })),
      address_table_lookups: message.addressTableLookups.map((alt) => ({
        account_key: alt.accountKey.toBase58(),
        readonly_indexes: alt.readonlyIndexes,
        writable_indexes: alt.writableIndexes,
      })),
    },
  };

  return req;
}
