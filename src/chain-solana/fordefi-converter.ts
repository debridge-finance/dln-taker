import {
  Connection,
  AddressLookupTableAccount,
  PublicKey,
  VersionedTransaction,
  MessageV0,
} from '@solana/web3.js';
import { CreateSolanaRawTransactionRequest } from '../forDefiClient/types/createTransaction';

// separate class to make testing easier
export class SolanaForDefiConverter {
  readonly #connection: Connection;

  constructor(connection: Connection) {
    this.#connection = connection;
  }

  private altCache: Map<string, AddressLookupTableAccount> = new Map();

  private async fetchALT(address: PublicKey): Promise<AddressLookupTableAccount> {
    const altKey = address.toBase58();
    if (!this.altCache.has(altKey)) {
      const alt = await this.#connection.getAddressLookupTable(address);
      if (alt.value === null) throw new Error(`Failed to fetch alt ${altKey} from chain`);
      this.altCache.set(altKey, alt.value);
    }
    return this.altCache.get(altKey)!;
  }

  async convert(
    tx: VersionedTransaction,
    note: string,
    vault_id: string,
  ): Promise<CreateSolanaRawTransactionRequest> {
    const loadedAlts = await Promise.all(
      tx.message.addressTableLookups.map((compiledAlt) => this.fetchALT(compiledAlt.accountKey)),
    );
    const message = tx.message as MessageV0;
    const accounts = message.getAccountKeys({ addressLookupTableAccounts: loadedAlts });
    const totalAccountsCount = message.staticAccountKeys.length + message.numAccountKeysFromLookups;
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
        accounts: Array.from({ length: totalAccountsCount }).map((_, idx) => ({
          address: accounts.get(idx)!.toBase58(),
          signer: tx.message.isAccountSigner(idx),
          writable: tx.message.isAccountWritable(idx),
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
}
