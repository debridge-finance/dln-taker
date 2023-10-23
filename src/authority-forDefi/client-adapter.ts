import { ChainId } from '@debridge-finance/dln-client';
import { SupportedChain } from '../config';
import { assert } from '../errors';
import { ChainName } from './types/shared';

const chainNameByChainIdMap: { [key in SupportedChain]: ChainName | null } = {
  [SupportedChain.Arbitrum]: 'evm_arbitrum_mainnet',
  [SupportedChain.Avalanche]: 'evm_avalanche_chain',
  [SupportedChain.BSC]: 'evm_bsc_mainnet',
  [SupportedChain.Ethereum]: 'evm_ethereum_mainnet',
  [SupportedChain.Fantom]: 'evm_fantom_mainnet',
  [SupportedChain.Linea]: 'evm_linea_mainnet',
  [SupportedChain.Polygon]: 'evm_polygon_mainnet',
  [SupportedChain.Solana]: 'solana_mainnet',
  [SupportedChain.Base]: 'evm_base_mainnet',
  [SupportedChain.Optimism]: 'evm_optimism_mainnet',
};

export function convertChainIdToChain(chainId: ChainId): ChainName {
  const chainName = chainNameByChainIdMap[chainId as any as SupportedChain];
  assert(chainName !== null, `unexpected: ForDeFi does not support ${ChainId[chainId]}`);
  return chainName;
}
