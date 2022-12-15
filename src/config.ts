import {
  ChainId,
  PriceTokenService,
  SwapConnector,
  TokensBucket,
} from "@debridge-finance/dln-client";

import { GetNextOrder } from "./interfaces";
import { OrderProcessorInitializer } from "./processors";
import { OrderValidatorInitializer } from "./validators/order.validator";

type address = string;

export class EvmRebroadcastAdapterOpts {
  /**
   * defines a multiplier to increase a pending txn's gasPrice for pushing it off the mempool.
   * Default: 1.15
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

  /**
   * gas price cap for bumped gas price during transaction rebroadcasting
   */
  rebroadcastMaxBumpedGasPriceWei?: number;
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
    evmRebroadcastAdapterOpts?:EvmRebroadcastAdapterOpts;
  }

  solana?: {
    debridgeSetting?: string;
  }
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

  //
  // chain context related
  //

  environment?: ChainEnvironment,

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
   * Represents a list of validators which filter out orders for fulfillment
   */
  srcValidators?: OrderValidatorInitializer[];

  /**
   * Represents a list of validators which filter out orders for fulfillment
   */
  dstValidators?: OrderValidatorInitializer[];

  /**
   * Defines an order processor that implements the fulfillment strategy
   */
  orderProcessor?: OrderProcessorInitializer;
}

export interface ExecutorLaunchConfig {
  /**
   * Represents a list of validators which filter out orders for fulfillment
   */
  validators?: OrderValidatorInitializer[];

  /**
   * Defines an order processor that implements the fulfillment strategy
   */
  orderProcessor?: OrderProcessorInitializer;

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

  buckets: TokensBucket[];
}
