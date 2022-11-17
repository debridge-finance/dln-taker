import {
  ChainId,
  PriceTokenService,
  SwapConnector,
} from "@debridge-finance/pmm-client";

import { GetNextOrder } from "./interfaces";
import { OrderProcessor } from "./processors/order.processor";
import { OrderValidator } from "./validators/order.validator";

type address = string;

/**
 * Represents a chain configuration where orders can be fulfilled.
 */
export interface ChainConfig {
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
  deBridge?: address;

  /**
   * EVM: contract address responsible for swaps
   */
  crossChainForwarderAddress?: address;

  /**
   * Internal settings
   */
  deBridgeSettings?: {
    debridge: string;
    setting: string;
  };

  //
  // taker related
  //

  /**
   * Taker controlled address where the orders (fulfilled on other chains) would unlock the funds to.
   */
  beneficiary: address;

  /**
   * The private key for the wallet with funds to fulfill orders
   */
  takerPrivateKey: string;

  /**
   * Represents a list of validators which filter out orders for fulfillment
   */
  srcValidators?: OrderValidator[];

  /**
   * Represents a list of validators which filter out orders for fulfillment
   */
  dstValidators?: OrderValidator[];

  /**
   * Defines an order processor that implements the fulfillment strategy
   */
  orderProcessor?: OrderProcessor;
}

export interface ExecutorConfig {
  /**
   * Represents a list of validators which filter out orders for fulfillment
   */
  orderValidators?: OrderValidator[];

  /**
   * Token price provider
   * Default: CoingeckoPriceFeed
   */
  tokenPriceService?: PriceTokenService;

  /**
   * Swap connector
   * Default: OneInchConnector
   */
  swapConnector?: SwapConnector;

  /**
   * Source of orders
   */
  orderFeed: string | GetNextOrder;

  /**
   * Defines an order processor that implements the fulfillment strategy
   */
  orderProcessor?: OrderProcessor;

  chains: ChainConfig[];
}
