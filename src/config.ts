import {ChainId, PMMClient, PriceTokenService, SwapConnector} from "@debridge-finance/pmm-client"
import {GetNextOrder} from "./interfaces"
import { Order } from "./pmm_common";
import {OrderData} from "@debridge-finance/pmm-client/src/order";

// todo: reuse internal Address representation and remove
type address = string;

/**
 * Represents an order validation routine. Can be chained.
 * Returns true if order can be processed, false otherwise.
 */
export type OrderValidator = (order: OrderData, client: PMMClient, config: ExecutorConfig) => Promise<boolean>;

export interface OrderProcessorContext {
    client: PMMClient;
    orderFulfilledMap: Map<string, boolean>;
}

/**
 * Represents an order fulfillment engine. Cannot be chained, but can be nested.
 *
 */
export type OrderProcessor = (orderId: string, order: OrderData, executorConfig: ExecutorConfig, fulfillableChainConfig: FulfillableChainConfig, context: OrderProcessorContext) => Promise<void>;

/**
 * Represents a chain configuration where orders can be fulfilled.
 */
export type FulfillableChainConfig = {
    //
    // network related
    //

    /**
     * Supported chain discriminator
     */
    chain: ChainId,

    /**
     * URL to the chain's RPC node
     */
    chainRpc: string,

    //
    // chain context related
    //

    /**
     * Address of the DLN contract responsible for order creation, unlocking and cancellation
     */
    pmmSrc?: address,

    /**
     * Address of the DLN contract responsible for order fulfillment
     */
    pmmDst?: address,

    /**
     * Address of the deBridgeGate contract responsible for cross-chain messaging (used by pmmDst)
     */
    deBridge?: address,

    crossChainForwarderAddress?: address;

    deBridgeSettings?: {
        debridge: string;
        setting: string;
    },

    //
    // taker related
    //

    /**
     * Taker controlled address where the orders (fulfilled on other chains) would unlock the funds to.
     */
    beneficiary: address,

    /**
     * The private key for the wallet with funds to fulfill orders
     */
    wallet: string,

    /**
     * Represents a list of validators which filter out orders for fulfillment
     */
    orderValidators?: OrderValidator[],

    /**
     * Defines an order processor that implements the fulfillment strategy
     */
    orderProcessor?: OrderProcessor,
}

export interface ExecutorConfig {
    /**
     * Token price provider
     *
     * Default: CoingeckoPriceFeed
     */
    priceTokenService?: PriceTokenService;

    /**
     * Swap connector.
     *
     * Default: OneInchConnector
     */
    swapConnector?: SwapConnector;

    /**
     * Represents a list of validators which filter out orders for fulfillment
     */
    orderValidators?: OrderValidator[],

    /**
     * Defines an order processor that implements the fulfillment strategy
     *
     * Default: strictProcessor
     */
    orderProcessor?: OrderProcessor,

    orderFeed: GetNextOrder;
    fulfillableChains: FulfillableChainConfig[];
}
