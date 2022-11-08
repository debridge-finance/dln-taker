import { ExecutorConfig, OrderValidator } from "./config";
import { Address, Order } from "./pmm_common";

/**
 * checks if srcChain is defined (we need to know its beneficiary)
 */
export function srcChainIsRegistered(): OrderValidator {
    return async (order: Order, config: ExecutorConfig) => Promise.resolve(true);
}


/**
 * checks if order profitability is at least as given (comparing dollar equiv of give and take amounts)
 */
 export function orderIsProfitable(profitabilityMinBps: number): OrderValidator {
    return async (order: Order, config: ExecutorConfig) => {
        // Compare $USD of order.giveAmount and $USD of order.takeAmount
        // Return true if the difference is >=  profitabilityMinBps
        return Promise.resolve(false)
    };
}


/**
 * checks if order's input token is allowed
 */
 export function giveTokenIsAllowed(): OrderValidator {
    return async (order: Order, config: ExecutorConfig) => {
        // check if order.giveToken is listed in srcChain's whitelistedGiveTokens
        return Promise.resolve(false)
    };
}


/**
 * checks if giveAmount's dollar cost is within range
 */
 export function giveAmountDollarEquiv(tokenAddress: Address[]): OrderValidator {
    return async (order: Order, config: ExecutorConfig) => {
        // check if order.takeToken is within tokenAddress
        const exists = -1 !== tokenAddress.indexOf(order.take!.tokenAddress);
        return Promise.resolve(exists)
    };
}


/**
 * checks if takeAmount's dollar cost is within range
 */
 export function takeAmountDollarEquiv(minDollarEquiv: BigInt, maxDollarEquiv: BigInt): OrderValidator {
    return async (order: Order, config: ExecutorConfig) => {
        // check if $USD of order.takeAmount within the given [minDollarEquiv, maxDollarEquiv]
        const exists = -1 !== tokenAddress.indexOf(order.take!.tokenAddress);
        return Promise.resolve(exists)
    };
}
