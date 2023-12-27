import { ChainName, EvmTransaction, SolanaTransaction } from './shared';

export type SignedCreateTransactionRequest = {
  requestBody: string;
  timestamp: string;
  signature: string;
};

export type CreateTransactionResponse = EvmTransaction | SolanaTransaction;

export type CreateTransactionRequest =
  | CreateEvmRawTransactionRequest
  | CreateSolanaRawTransactionRequest;

export type CreateEvmRawTransactionRequest = {
  vault_id: string;
  note: string;
  signer_type: 'api_signer';
  type: 'evm_transaction';
  details: {
    type: 'evm_raw_transaction';
    use_secure_node: boolean;
    chain: ChainName;
    gas:
      | {
          gas_limit: string;
          type: 'custom';
          details:
            | {
                type: 'legacy';
                price: string;
              }
            | {
                type: 'dynamic';
                max_priority_fee_per_gas: string;
                max_fee_per_gas: string;
              };
        }
      | {
          gas_limit: string;
          type: 'priority';
          priority_level: 'low' | 'medium' | 'high';
        };
    to: string;
    value: string;
    data: {
      type: 'hex';
      hex_data: string;
    };
    fail_on_prediction_failure?: boolean;
  };
};

export type CreateSolanaRawTransactionRequest = {
  vault_id: string;
  note: string;
  signer_type: 'api_signer';
  type: 'solana_transaction';
  details: {
    type: 'solana_raw_transaction';
    chain: 'solana_mainnet';
    version: 'legacy' | 'v0';
    instructions: Array<{
      program_index: number;
      data: string;
      account_indexes: Array<number>;
    }>;
    accounts: Array<{
      address: string;
      writable: boolean;
      signer: boolean;
      ephemeral_key?: string;
    }>;
    address_table_lookups: Array<{
      account_key: string;
      writable_indexes: Array<number>;
      readonly_indexes: Array<number>;
    }>;
  };
};