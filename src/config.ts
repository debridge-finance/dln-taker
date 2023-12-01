import { ChainId, PriceTokenService } from '@debridge-finance/dln-client';

import { OrderFilterInitializer } from './filters/order.filter';
import { GetNextOrder } from './interfaces';
import { Hooks } from './hooks/HookEnums';
import { HookHandler } from './hooks/HookHandler';

type StringifiedAddress = string;

export enum SupportedChain {
  Arbitrum = ChainId.Arbitrum,
  Avalanche = ChainId.Avalanche,
  BSC = ChainId.BSC,
  Ethereum = ChainId.Ethereum,
  Fantom = ChainId.Fantom,
  Linea = ChainId.Linea,
  Polygon = ChainId.Polygon,
  Solana = ChainId.Solana,
  Base = ChainId.Base,
  Optimism = ChainId.Optimism,
}

export const BLOCK_CONFIRMATIONS_HARD_CAPS: { [key in SupportedChain]: number } = {
  [SupportedChain.Arbitrum]: 12,
  [SupportedChain.Avalanche]: 12,
  [SupportedChain.BSC]: 12,
  [SupportedChain.Ethereum]: 12,
  [SupportedChain.Fantom]: 12,
  [SupportedChain.Linea]: 12,
  [SupportedChain.Base]: 12,
  [SupportedChain.Optimism]: 12,
  [SupportedChain.Polygon]: 256,
  [SupportedChain.Solana]: 32,
};

export const avgBlockSpeed: { [key in SupportedChain]: number } = {
  [ChainId.Arbitrum]: 0.4,
  [ChainId.Avalanche]: 2,
  [ChainId.BSC]: 3,
  [ChainId.Ethereum]: 12,
  [ChainId.Polygon]: 2.3,
  [ChainId.Fantom]: 2,
  [ChainId.Linea]: 12,
  [ChainId.Solana]: 0.4,
  [ChainId.Base]: 2,
  [ChainId.Optimism]: 2,
};

export enum DexlessChains {
  Linea = ChainId.Linea,
  Neon = ChainId.Neon,
}

type PrivateKeyAuthority = {
  type: 'PK';
  privateKey: string;
};
export type SignerAuthority = PrivateKeyAuthority;

export class EvmRebroadcastAdapterOpts {
  /**
   * defines a multiplier to increase a pending txn's gasPrice for pushing it off the mempool.
   * Default: 1.11
   */
  bumpGasPriceMultiplier?: number;

  /**
   * defines an interval (in ms) of how often to query RPC to detect if the fulfill txn has been included to the block
   * default: chain's avgBlockSpeed
   */
  pollingInterval?: number;

  /**
   * max time frame to wait for fulfillment transaction for inclusion. Otherwise, skip fulfillment
   * default: 24 blocks (24 * chain's avgBlockSpeed)
   */
  pollingTimeframe?: number;

  /**
   * defines an interval (in ms) of how often to rebroadcast the tx to force its inclusion to the block
   * Default: 6 blocks (6 * chain's avgBlockSpeed)
   */
  rebroadcastInterval?: number;

  /**
   * number of attempts to rebroadcast tx with bumped gasPrice
   * default: 3
   */
  rebroadcastMaxAttempts?: number;
}

export type ChainEnvironment = {
  /**
   * Address of the DLN contract responsible for order creation, unlocking and cancellation
   */
  pmmSrc?: StringifiedAddress;

  /**
   * Address of the DLN contract responsible for order fulfillment
   */
  pmmDst?: StringifiedAddress;

  /**
   * Address of the deBridgeGate contract responsible for cross-chain messaging (used by pmmDst)
   */
  deBridgeContract?: StringifiedAddress;

  evm?: {
    forwarderContract?: StringifiedAddress;
    evmRebroadcastAdapterOpts?: EvmRebroadcastAdapterOpts;
  };

  solana?: {
    debridgeSetting?: string;
  };
};

export type DstOrderConstraints = {
  /**
   * Defines a delay (in seconds) the dln-taker should wait before starting to process each new (non-archival) order
   * coming to this chain after it first saw it.
   */
  fulfillmentDelay?: number;

  /**
   * Defines a target where pre-fulfill swap change should be send to. Default: "taker".
   * Warning: applies to EVM chains only
   */
  preFulfillSwapChangeRecipient?: 'taker' | 'maker';
};

export type SrcConstraints = {
  /**
   * Defines a budget (priced in the US dollar) of assets deployed and locked on the given chain. Any new order coming
   * from the given chain to any other supported chain that potentially increases the TVL beyond the given budget
   * (if being successfully fulfilled) gets rejected.
   *
   * The TVL is calculated as a sum of:
   * - the total value of intermediary assets deployed on the taker account (represented as takerPrivateKey)
   * - PLUS the total value of intermediary assets deployed on the unlock_beneficiary account (represented
   *   as unlockAuthorityPrivateKey, if differs from takerPrivateKey)
   * - PLUS the total value of intermediary assets locked by the DLN smart contract that yet to be transferred to
   *   the unlock_beneficiary account as soon as the commands to unlock fulfilled (but not yet unlocked) orders
   *   are sent from other chains
   * - PLUS the total value of intermediary assets locked by the DLN smart contract that yet to be transferred to
   *   the unlock_beneficiary account as soon as all active unlock commands (that were sent from other chains
   *   but were not yet claimed/executed on the given chain) are executed.
   */
  TVLBudget?: number;

  /**
   * Sets the min profitability expected for orders coming from this chain
   */
  minProfitabilityBps?: number;

  /**
   * affects order profitability because the deBridge app and the API reserves the cost of unlock in the order's margin,
   * assuming that the order would be unlocked in a batch of size=10. Reducing the batch size to a lower value increases
   * your unlock costs and thus reduces order profitability, making them unprofitable most of the time.
   */
  batchUnlockSize?: number;
};

export type SrcOrderConstraints = {
  /**
   * Defines a delay (in seconds) the dln-taker should wait before starting to process each new (non-archival) order
   * coming from this chain after it first saw it.
   */
  fulfillmentDelay?: number;

  /**
   *
   * Throughput is total value of orders from this range fulfilled across all the chains during the last N sec.
   *
   * The throughput should be set with throughputTimeWindowSec
   */
  maxFulfillThroughputUSD?: number;

  /**
   * Throughput is total value of orders from this range fulfilled across all the chains during the last N sec
   */
  throughputTimeWindowSec?: number;
};

/**
 * Represents a chain configuration where orders can be fulfilled.
 */
export interface ChainDefinition {
  //
  // network related
  //

  /**
   * Supported chain discriminator
   */
  chain: ChainId;

  /**
   * URL to the chain's RPC node
   */
  chainRpc: string;

  /**
   * Forcibly disable fulfills in this chain?
   */
  disabled?: boolean;

  /**
   * chain context related
   */
  environment?: ChainEnvironment;

  /**
   * Defines constraints imposed on all orders coming from this chain
   */
  constraints?: SrcConstraints &
    SrcOrderConstraints & {
      /**
       * Defines necessary and sufficient block confirmation thresholds per worth of order expressed in dollars.
       * For example, you may want to fulfill orders coming from Ethereum:
       * - worth <$100 - immediately (after 1 block confirmation)
       * - worth <$1,000 — after 6 block confirmations
       * - everything else (worth $1,000+) - after default 12 block confirmations,
       * then you can configure it:
       *
       * ```
       * requiredConfirmationsThresholds: [
       *  {thresholdAmountInUSD: 100, minBlockConfirmations: 1},     // worth <$100: 1+ block confirmation
       *  {thresholdAmountInUSD: 1_000, minBlockConfirmations: 6},   // worth <$1,000: 6+ block confirmations
       * ]
       * ```
       */
      requiredConfirmationsThresholds?: Array<
        SrcOrderConstraints & {
          thresholdAmountInUSD: number;
          minBlockConfirmations?: number;
        }
      >;
    };

  /**
   * Defines constraints imposed on all orders coming to this chain. These properties have precedence over `constraints` property
   */
  dstConstraints?: DstOrderConstraints & {
    /**
     * Defines custom constraints for orders falling into the given upper thresholds expressed in US dollars.
     *
     * Mind that these constraints have precedence over higher order constraints
     */
    perOrderValueUpperThreshold?: Array<
      DstOrderConstraints & {
        minBlockConfirmations: number;
      }
    >;
  };

  //
  // taker related
  //

  /**
   * Taker controlled address where the orders (fulfilled on other chains) would unlock the funds to.
   */
  beneficiary: StringifiedAddress;

  /**
   * Authority responsible for initializing txns (applicable for Solana only)
   */
  initAuthority?: SignerAuthority;

  /**
   * Authority responsible for creating fulfill txns
   */
  fulfillAuthority?: SignerAuthority;

  /**
   * Authority responsible for creating unlock txns
   */
  unlockAuthority?: SignerAuthority;

  /**
   * The private key for the wallet with funds to fulfill orders. Must have enough reserves and native currency
   * to fulfill orders
   * @deprecated Use fulfillAuthority
   */
  takerPrivateKey?: string;

  /**
   * The private key for the wallet who is responsible for sending order unlocks (must differ from takerPrivateKey).
   * Must have enough ether to unlock orders
   * @deprecated Use unlockAuthority
   */
  unlockAuthorityPrivateKey?: string;

  /**
   * Represents a list of filters which filter out orders for fulfillment
   */
  srcFilters?: OrderFilterInitializer[];

  /**
   * Represents a list of filters which filter out orders for fulfillment
   */
  dstFilters?: OrderFilterInitializer[];
}

export interface ExecutorLaunchConfig {
  /**
   * Represents a list of filters which filter out orders for fulfillment
   */
  filters?: OrderFilterInitializer[];

  /**
   * Hook handlers
   */
  hookHandlers?: {
    [key in Hooks]?: HookHandler<key>[];
  };

  /**
   * Token price provider
   * Default: CoingeckoPriceFeed
   */
  tokenPriceService?: PriceTokenService;

  /**
   * Source of orders
   */
  orderFeed?: string | GetNextOrder;

  srcConstraints?: SrcConstraints;

  chains: ChainDefinition[];

  /**
   * Defines buckets of tokens that have equal value and near-zero re-balancing costs across supported chains
   */
  buckets: Array<{
    [key in ChainId]?: string | Array<string>;
  }>;

  jupiterConfig?: {
    apiToken?: string;
    maxAccounts?: number;
    blacklistedDexes?: Array<string>;
  };
}
