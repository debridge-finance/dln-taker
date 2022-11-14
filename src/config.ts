import {ChainId, PMMClient, PriceTokenService, SwapConnector} from "@debridge-finance/pmm-client"
import {GetNextOrder} from "./interfaces"
import { Order } from "./pmm_common";
import {OrderData} from "@debridge-finance/pmm-client/src/order";

// todo: reuse internal Address representation and remove
type address = string;

/**
 * Represents an order validation routine. Can be chained.
 * Returns true if order can be processed, false otherwise.
 *
 * TODO discuss arguments!
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

    /**
     * Solana related
     */
    deBridgeSettings?: {
        debridge: string;
        setting: string;
    },

    //
    // taker related
    //

    /**
     * Taker controlled address where the orders (fulfilled on other chains) would unlock the funds to.
     *
     * This setting is used by another FulfillableChainConfig while fulfilling an order created on this
     * particular chain.
     */
    beneficiary: address,

    /**
     * The private key for the wallet with funds to fulfill orders
     */
    wallet: string,

    /**
     * Represents a list of validators which filter out orders from the orders feed to be fulfilled
     *
     * possible chainable validators:
     *  - srcChainIsRegistered() checks if srcChain is defined (we need to know its beneficiary)
     *  - orderIsProfitable(bps) checks if order profitability is at least as given (comparing dollar equiv of give and take amounts)
     *  - giveTokenIsAllowed() checks if order's input token is allowed
     *  - giveAmountDollarEquiv(min, max) checks if giveAmount's dollar cost is within range
     *  - takeAmountDollarEquiv(min, max) checks if takeAmount's dollar cost is within range
     */
    orderValidators?: OrderValidator[],

    /**
     * Represents an order processor which fulfills orders. You can create your own modular processor
     * which reuses one or another existing processor
     *
     * possible order processors:
     * - match() - fulfills the order taking tokens from the wallet, if enough funds presented
     * - preswap() - fulfills the order making a preswap from specific token
     */
    orderProcessor?: OrderProcessor,
}

export interface ExecutorConfig {
    /**
     * Token price provider
     * default coingecko
     */
    priceTokenService?: PriceTokenService;

    /**
     * Swap connector
     * default 1inch
     */
    swapConnector?: SwapConnector;

    /**
     * Represents a list of validators which filter out orders from the orders feed to be fulfilled
     *
     * possible chainable validators:
     *  - srcChainIsRegistered() checks if srcChain is defined (we need to know its beneficiary)
     *  - orderIsProfitable(bps) checks if order profitability is at least as given (comparing dollar equiv of give and take amounts)
     *  - giveTokenIsAllowed() checks if order's input token is allowed
     *  - giveAmountDollarEquiv(min, max) checks if giveAmount's dollar cost is within range
     *  - takeAmountDollarEquiv(min, max) checks if takeAmount's dollar cost is within range
     */
    orderValidators?: OrderValidator[],

    /**
     * Represents an order processor which fulfills orders. You can create your own modular processor
     * which reuses one or another existing processor
     *
     * possible order processors:
     * - match() - fulfills the order taking tokens from the wallet, if enough funds presented
     * - preswap() - fulfills the order making a preswap from specific token
     */
    orderProcessor?: OrderProcessor,

    orderFeed: GetNextOrder;
    fulfillableChains: FulfillableChainConfig[];
}
