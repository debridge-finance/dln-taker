import { ChainId } from '@debridge-finance/dln-client';
import Web3 from 'web3';
import { getAvgBlockSpeed, getFinalizedBlockConfirmations } from '../../config';
import { assert } from '../../errors';
import { suggestEvmTxBroadcasterOpts, EvmTxBroadcasterOpts } from '../networking/broadcaster';
import { defaultFeeManagerOpts } from '../fees/defaults';
import {
  EvmFeeFetchers,
  EvmFeeManager,
  EvmFeeManagerOpts,
  getDefaultFetchers,
  IEvmFeeManager,
} from '../fees/manager';
import { suggestedOpts as bnbSuggestions } from './BNB';
import { suggestedOpts as polygonSuggestions } from './Polygon';

export type EvmChainPreferences = {
  feeManager: IEvmFeeManager;
  parameters: EvmChainParameters;
  broadcasterOpts: EvmTxBroadcasterOpts;
};

type InputOpts = {
  connection: Web3;
  feeManagerOpts?: Partial<EvmFeeManagerOpts>;
  parameters?: Partial<EvmChainParameters>;
  broadcasterOpts?: Partial<EvmTxBroadcasterOpts>;
};

export type SuggestedOpts = {
  feeManagerOpts?: Partial<EvmFeeManagerOpts>;
  feeHandlers?: (fees: EvmFeeManagerOpts) => Partial<EvmFeeFetchers>;
  parameters?: Partial<EvmChainParameters>;
  broadcasterOpts?: Partial<EvmTxBroadcasterOpts>;
};

export type EvmChainParameters = {
  isLegacy: boolean;
  avgBlockSpeed: number;
  finalizedBlockConfirmations: number;
};

// see https://docs.rs/ethers-core/latest/src/ethers_core/types/chain.rs.html#55-166
const eip1559Compatible: Array<ChainId> = [
  ChainId.Arbitrum,
  ChainId.Avalanche,
  ChainId.Ethereum,
  ChainId.Linea,
  ChainId.Polygon,
  ChainId.Base,
  ChainId.Optimism,
];

const chainSuggestions: { [key in ChainId]?: SuggestedOpts } = {
  [ChainId.BSC]: bnbSuggestions,
  [ChainId.Polygon]: polygonSuggestions,
};

function getDefaultParametersFor(chainId: ChainId) {
  return {
    isLegacy: !eip1559Compatible.includes(chainId),
    avgBlockSpeed: getAvgBlockSpeed(chainId),
    finalizedBlockConfirmations: getFinalizedBlockConfirmations(chainId),
  };
}

export class EvmChainPreferencesStore {
  static #store: { [key in ChainId]?: EvmChainPreferences } = {};

  static set(chainId: ChainId, input: InputOpts) {
    assert(
      !EvmChainPreferencesStore.#store[chainId],
      `${ChainId[chainId]} preferences store already initialized`,
    );

    const evmFeeOpts: EvmFeeManagerOpts = {
      ...defaultFeeManagerOpts,
      ...chainSuggestions[chainId]?.feeManagerOpts,
      ...input.feeManagerOpts,
    };
    const evmFeeHandlers: EvmFeeFetchers = {
      ...getDefaultFetchers(evmFeeOpts),
      ...chainSuggestions[chainId]?.feeHandlers?.(evmFeeOpts),
    };
    const parameters: EvmChainParameters = {
      ...getDefaultParametersFor(chainId),
      ...chainSuggestions[chainId]?.parameters,
      ...input.parameters,
    };
    EvmChainPreferencesStore.#store[chainId] = {
      parameters,
      feeManager: new EvmFeeManager(
        input.connection,
        parameters.isLegacy,
        evmFeeOpts,
        evmFeeHandlers,
      ),
      broadcasterOpts: {
        ...suggestEvmTxBroadcasterOpts(parameters.avgBlockSpeed),
        ...input.broadcasterOpts,
      },
    };
  }

  static get(chainId: ChainId): EvmChainPreferences {
    assert(
      EvmChainPreferencesStore.#store[chainId] !== undefined,
      `${ChainId[chainId]} preferences store not yet initialized`,
    );
    return EvmChainPreferencesStore.#store[chainId]!;
  }
}
