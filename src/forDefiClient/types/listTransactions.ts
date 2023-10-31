import { EvmTransaction, SolanaTransaction, ChainName } from './shared';

export type ListTransactionsResponse = {
  total: number;
  page: number;
  size: number;
  transactions: Array<EvmTransaction | SolanaTransaction>;
};

export type ListTransactionsRequest = {
  page?: number;
  size?: number;
  created_before?: string;
  created_after?: string;
  modified_after?: string;
  vault_ids?: string[];
  chains?: ChainName[];
  initiator_ids?: string[];
  states?: Array<'pending' | 'finalized' | 'approved'>;
  types?: Array<'evm_transaction' | 'solana_transaction'>;
  sub_types?: Array<string>;
  signer_types?: Array<'initiator' | 'api_signer' | 'end_user'>;
  transaction_ids?: Array<string>;
  end_user_ids?: Array<string>;
  is_hidden?: boolean;
  sort_by?:
    | 'created_at_asc'
    | 'created_at_desc'
    | 'modified_at_asc'
    | 'modified_at_desc'
    | 'type_asc'
    | 'type_desc'
    | 'chains_asc'
    | 'chains_desc'
    | 'initiators_asc'
    | 'initiators_desc'
    | 'state_asc'
    | 'state_desc';
};
