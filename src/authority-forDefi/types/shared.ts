export type TxState =
  | 'waiting_for_approval'
  | 'approved'

  // finalized state:
  | 'signed'
  | 'pushed_to_blockchain'
  | 'queued'
  | 'mined'
  | 'completed'
  | 'aborted'
  | 'error_signing'
  | 'error_pushing_to_blockchain'
  | 'mined_reverted'
  | 'completed_reverted'
  | 'stuck'
  | 'accelerating'
  | 'canceling'
  | 'accelerated'
  | 'cancelled';

export type ChainName =
  | 'evm_1'
  | 'evm_5'
  | 'evm_10'
  | 'evm_56'
  | 'evm_100'
  | 'evm_137'
  | 'evm_250'
  | 'evm_324'
  | 'evm_1101'
  | 'evm_2222'
  | 'evm_7700'
  | 'evm_8453'
  | 'evm_80001'
  | 'evm_42161'
  | 'evm_43114'
  | 'evm_59144'
  | 'evm_11155111'
  | 'evm_ethereum_mainnet'
  | 'evm_ethereum_goerli'
  | 'evm_optimism_mainnet'
  | 'evm_bsc_mainnet'
  | 'evm_gnosis_mainnet'
  | 'evm_polygon_mainnet'
  | 'evm_fantom_mainnet'
  | 'evm_arbitrum_mainnet'
  | 'evm_avalanche_chain'
  | 'evm_kava_mainnet'
  | 'evm_polygon_mumbai'
  | 'evm_ethereum_sepolia'
  | 'evm_polygon_zkevm_mainnet'
  | 'evm_zksync_era_mainnet'
  | 'evm_base_mainnet'
  | 'evm_linea_mainnet'
  | 'evm_canto_mainnet'
  | 'solana_mainnet'
  | 'solana_devnet'
  | 'cosmos_cosmoshub-4'
  | 'cosmos_osmosis-1'
  | 'cosmos_dydx-testnet-3'
  | 'cosmos_dydx-testnet-4';

export type EvmTransaction = {
  id: string;
  note: string;
  state: TxState;
};

export type SolanaTransaction = {
  id: string;
  note: string;
  state: TxState;
};

export type ErrorResponse = {
  title: string;
  detail: string;
  request_id: string;
};
