import { OrderProcessor } from "./config";
import { Address } from "./pmm_common";

/**
 * Represents an order fulfillment engine which fulfills orders taking the exact amount from the wallet
 */
export function matchProcessor(): OrderProcessor {
    return async () => {

    }
}

/**
 * Represents an order fulfillment engine which swaps the given asset (inputToken) to a token
 * requested in the order
 */
export function preswapProcessor(inputToken: Address): OrderProcessor {
    return async () => {

    }
}