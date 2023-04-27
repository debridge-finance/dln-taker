import { Logger } from "pino";

export class UnconfirmedOrdersBudgetController {

    private spentBudgetInUSD: number = 0;
    private readonly orders = new Map<string, number>(); //key - orderId, value - usdWorth

    constructor(private readonly unconfirmedOrdersBudgetInUSD?: number) {}

    validateOrder(orderId: string, usdWorth: number, orderLogger: Logger): boolean|never {
        if (!this.unconfirmedOrdersBudgetInUSD) {
            return true;
        }
        const logger = orderLogger.child({ service: UnconfirmedOrdersBudgetController.name });
        const potentialSpentBudgetInUSD = this.spentBudgetInUSD + usdWorth - (this.orders.get(orderId) || 0);
        if (potentialSpentBudgetInUSD > this.unconfirmedOrdersBudgetInUSD) {
            const message = `Order with usd worth ${usdWorth} is out of budget ${this.unconfirmedOrdersBudgetInUSD}(spent ${this.spentBudgetInUSD})`;
            logger.warn(message);
            throw new Error(message);
        }

        logger.debug(`Order is validated`);
        return true;
    }

    validateAndAddOrder(orderId: string, usdWorth: number, orderLogger: Logger): boolean|never {
        if (!this.unconfirmedOrdersBudgetInUSD) {
            return true;
        }
        const potentialSpentBudgetInUSD = this.spentBudgetInUSD + usdWorth - (this.orders.get(orderId) || 0);
        this.validateOrder(orderId, usdWorth, orderLogger);

        this.spentBudgetInUSD = potentialSpentBudgetInUSD;
        this.orders.set(orderId, usdWorth);
        return true;
    }

    removeOrder(orderId: string, orderLogger: Logger) {
        const logger = orderLogger.child({ service: UnconfirmedOrdersBudgetController.name });
        if (!this.orders.has(orderId)) {
            return;
        }
        const usdWorthOrder = this.orders.get(orderId)!;
        this.spentBudgetInUSD = this.spentBudgetInUSD - usdWorthOrder;
        this.orders.delete(orderId);
        logger.debug(`Order is deleted`);
    }
}