import {
  ChainId,
  PriceTokenService,
  SwapConnector,
  TokensBucket,
} from "@debridge-finance/dln-client";

import { OrderFilterInitializer } from "./filters/order.filter";
import { GetNextOrder } from "./interfaces";
import { OrderProcessorInitializer } from "./processors";
import { Hooks } from "./hooks/HookEnums";
import { HookHandler } from "./hooks/HookHandler";

type address = string;

export enum SupportedChain {
  Avalanche = ChainId.Avalanche,
  Arbitrum = ChainId.Arbitrum,
  BSC = ChainId.BSC,
  Ethereum = ChainId.Ethereum,
  Polygon = ChainId.Polygon,
  Solana = ChainId.Solana
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
  };
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

  //
  // chain context related
  //

  environment?: ChainEnvironment;

  /**
   * Defines constraints imposed on all orders coming from/to this chain
   */
  constraints?: {
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
    requiredConfirmationsThresholds?: Array<{thresholdAmountInUSD: number, minBlockConfirmations: number}>;
  }

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
  buckets: TokensBucket[];
}
