import { SupportedChain } from '../config';
import { ChainName } from './types/shared';

export function convertChainIdToChain(chainId: SupportedChain): ChainName {
  switch (chainId) {
    case SupportedChain.Arbitrum:
      return 'evm_arbitrum_mainnet';
    case SupportedChain.Avalanche:
      return 'evm_avalanche_chain';
    case SupportedChain.BSC:
      return 'evm_bsc_mainnet';
    case SupportedChain.Ethereum:
      return 'evm_ethereum_mainnet';
    case SupportedChain.Fantom:
      return 'evm_fantom_mainnet';
    case SupportedChain.Linea:
      return 'evm_linea_mainnet';
    case SupportedChain.Polygon:
      return 'evm_polygon_mainnet';
    case SupportedChain.Solana:
      return 'solana_mainnet';
    case SupportedChain.Base:
      return 'evm_base_mainnet';
    case SupportedChain.Optimism:
      return 'evm_optimism_mainnet';
    default:
      throw new Error(`Unsupported chain: ${chainId}`);
  }
}
