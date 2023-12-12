import { ChainId } from '@debridge-finance/dln-client';
import Web3 from 'web3';
import { avgBlockSpeed, BLOCK_CONFIRMATIONS_HARD_CAPS, SupportedChain } from '../../config';
import { assert } from '../../errors';
import { Optional } from '../../types';
import { getSuggestedOpts, TransactionBroadcasterOpts } from '../broadcaster/broadcaster';
import { defaultFeeManagerOpts } from '../fees/defaults';
import {
  EvmFeeHandlers,
  EvmFeeManager,
  EvmFeeOpts,
  getDefaultHandlers,
  IEvmFeeManager,
} from '../fees/manager';
import { suggestedOpts as bnbSuggestions } from './BNB';
import { suggestedOpts as polygonSuggestions } from './Polygon';

export type EvmChainPreferences = {
  feeManager: IEvmFeeManager;
  parameters: EvmChainParameters;
  broadcasterOpts: TransactionBroadcasterOpts;
};

type InputOpts = {
  connection: Web3;
  feeManagerOpts?: Optional<EvmFeeOpts>;
  parameters?: Optional<EvmChainParameters>;
  broadcasterOpts?: Optional<TransactionBroadcasterOpts>;
};

export type SuggestedOpts = {
  feeManagerOpts?: Optional<EvmFeeOpts>;
  feeHandlers?: (fees: EvmFeeOpts) => Optional<EvmFeeHandlers>;
  parameters?: Optional<EvmChainParameters>;
  broadcasterOpts?: Optional<TransactionBroadcasterOpts>;
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
    avgBlockSpeed: avgBlockSpeed[chainId as unknown as SupportedChain],
    finalizedBlockConfirmations:
      BLOCK_CONFIRMATIONS_HARD_CAPS[chainId as unknown as SupportedChain],
  };
}

export class EvmChainPreferencesStore {
  static #store: { [key in ChainId]?: EvmChainPreferences } = {};

  static set(chainId: ChainId, input: InputOpts) {
    assert(
      !EvmChainPreferencesStore.#store[chainId],
      `${ChainId[chainId]} preferences store already initialized`,
    );

    const evmFeeOpts: EvmFeeOpts = {
      ...defaultFeeManagerOpts,
      ...chainSuggestions[chainId]?.feeManagerOpts,
      ...input.feeManagerOpts,
    };
    const evmFeeHandlers: EvmFeeHandlers = {
      ...getDefaultHandlers(evmFeeOpts),
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
        chainId,
        input.connection,
        evmFeeOpts,
        evmFeeHandlers,
        parameters.isLegacy,
      ),
      broadcasterOpts: { ...getSuggestedOpts(parameters.avgBlockSpeed), ...input.broadcasterOpts },
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
