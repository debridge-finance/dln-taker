import {
  ChainId,
  PriceTokenService,
  SwapConnector,
} from "@debridge-finance/dln-client";

import { OrderFilterInitializer } from "./filters/order.filter";
import { GetNextOrder } from "./interfaces";
import { OrderProcessorInitializer } from "./processors";
import { Hooks } from "./hooks/HookEnums";
import { HookHandler } from "./hooks/HookHandler";

type address = string;

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

export enum DexlessChains {
  Base = ChainId.Base,
  Linea = ChainId.Linea,
}

export class EvmRebroadcastAdapterOpts {
  /**
   * defines a multiplier to increase a pending txn's gasPrice for pushing it off the mempool.
   * Default: 1.1
   */
  bumpGasPriceMultiplier?: number;

  /**
   * defines an interval (in ms) of how often to query RPC to detect if the fulfill txn has been included to the block
   * default: 5_000
   */
  pollingInterval?: number;

  /**
   * max time frame to wait for fulfillment transaction for inclusion. Otherwise, skip fulfillment
   * default: 210_000
   */
  pollingTimeframe?: number;

  /**
   * defines an interval (in ms) of how often to rebroadcast the tx to force its inclusion to the block
   * Default: 60_000
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
  pmmSrc?: address;

  /**
   * Address of the DLN contract responsible for order fulfillment
   */
  pmmDst?: address;

  /**
   * Address of the deBridgeGate contract responsible for cross-chain messaging (used by pmmDst)
   */
  deBridgeContract?: address;

  evm?: {
    forwarderContract?: address;
    evmRebroadcastAdapterOpts?: EvmRebroadcastAdapterOpts;
  };

  solana?: {
    debridgeSetting?: string;
    environment?: 'lima' | 'madrid' | 'prod'
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
    preFulfillSwapChangeRecipient?: "taker" | "maker";
}

export type SrcOrderConstraints = {
    /**
     * Defines a delay (in seconds) the dln-taker should wait before starting to process each new (non-archival) order
     * coming from this chain after it first saw it.
     */
    fulfillmentDelay?: number;
}

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
  constraints?: SrcOrderConstraints & {
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
    requiredConfirmationsThresholds?: Array<SrcOrderConstraints & {
      thresholdAmountInUSD: number,
      minBlockConfirmations?: number,
    }>;

    /**
     * Defines a budget (a hard cap) of all successfully fulfilled orders' value (expressed in USD) that
     * were not reached yet a guaranteed finality at the given point in time.
     * For example, if you have allowed to fulfill orders worth $1 from this chain after 1 block confirmation
     * (using the neighboring `requiredConfirmationsThresholds` property, while the guaranteed finalization is known
     * to be 12 blocks), and there is an accidental flood of 100,000 orders worth $1 occurs, you probably want to
     * prevent this by setting the budget for non-finalized orders.
     * If you set `nonFinalizedTVLBudget` to "100", than only first hundred of one-dollar orders would be attempted
     * to be fulfilled, and all other orders would be postponed to the internal queue where they would be pulled
     * one by one as soon as fulfilled orders are being finalized.
     */
    nonFinalizedTVLBudget?: number;
  },

  /**
   * Defines constraints imposed on all orders coming to this chain. These properties have precedence over `constraints` property
   */
  dstConstraints?: DstOrderConstraints & {
    /**
     * Defines custom constraints for orders falling into the given upper thresholds expressed in US dollars.
     *
     * Mind that these constraints have precedence over higher order constraints
     */
    perOrderValueUpperThreshold?: Array<DstOrderConstraints & {
      upperThreshold: number
    }>
  },

  //
  // taker related
  //

  /**
   * Taker controlled address where the orders (fulfilled on other chains) would unlock the funds to.
   */
  beneficiary: address;

  /**
   * The private key for the wallet with funds to fulfill orders. Must have enough reserves and native currency
   * to fulfill orders
   */
  takerPrivateKey: string;

  /**
   * The private key for the wallet who is responsible for sending order unlocks (must differ from takerPrivateKey).
   * Must have enough ether to unlock orders
   */
  unlockAuthorityPrivateKey: address;

  /**
   * Represents a list of filters which filter out orders for fulfillment
   */
  srcFilters?: OrderFilterInitializer[];

  /**
   * Represents a list of filters which filter out orders for fulfillment
   */
  dstFilters?: OrderFilterInitializer[];

  /**
   * Defines an order processor that implements the fulfillment strategy
   */
  orderProcessor?: OrderProcessorInitializer;
}

export interface ExecutorLaunchConfig {
  /**
   * Represents a list of filters which filter out orders for fulfillment
   */
  filters?: OrderFilterInitializer[];

  /**
   * Defines an order processor that implements the fulfillment strategy
   */
  orderProcessor?: OrderProcessorInitializer;

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
   * Swap connector
   */
  swapConnector?: SwapConnector;

  /**
   * Source of orders
   */
  orderFeed?: string | GetNextOrder;

  chains: ChainDefinition[];

  /**
   * Defines buckets of tokens that have equal value and near-zero re-balancing costs across supported chains
   */
  buckets: Array<{
    [key in ChainId]?: string | Array<string>
  }>;
}
