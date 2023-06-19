import { ChainId } from "@debridge-finance/dln-client";
import { Logger } from "pino";

// This controller simply keeps track of orders' worth that were attempted to be fulfilled
// while being non-finalized, to prevent TVL exceed the desired budget on a given chain
export class NonFinalizedOrdersBudgetController {

    #spent: number = 0;
    readonly #isControllerEnabled: boolean = false;
    readonly #logger: Logger;
    readonly #orders = new Map<string, number>(); //key - orderId, value - usdValue

    get spent(): number {
        return this.#spent;
    }

    constructor(public readonly chainId: ChainId, public readonly budget: number, logger: Logger) {
        this.#isControllerEnabled = budget > 0;

        this.#logger = logger.child({ service: NonFinalizedOrdersBudgetController.name, chainId, budget });
        logger.debug(`Initialized with budget: $${budget}`);
    }

    isFitsBudget(orderId: string, usdValue: number): boolean {
        if (!this.#isControllerEnabled) {
            return true;
        }

        const potentialSpentBudgetInUSD = this.#spent + usdValue - (this.#orders.get(orderId) || 0);
        if (potentialSpentBudgetInUSD > this.budget) {
            this.#logger.child({orderId})
                .debug(`order worth $${usdValue} does not fit budget; new budget utilization: ${potentialSpentBudgetInUSD} (${this.getBudgetUtilizationRate(potentialSpentBudgetInUSD)}%)`)
            return false;
        }

        return true;
    }

    addOrder(orderId: string, usdValue: number) {
        if (!this.#isControllerEnabled) {
            return true;
        }

        this.#spent = this.#spent + usdValue - (this.#orders.get(orderId) || 0);
        this.#orders.set(orderId, usdValue);

        this.#logger.child({orderId})
            .debug(`order worth $${usdValue} has been added, new budget utilization: ${this.#spent} (${this.getBudgetUtilizationRate()}%)`)
    }

    removeOrder(orderId: string) {
        const usdValue = this.#orders.get(orderId) || 0;
        this.#spent = this.#spent - usdValue;

        this.#orders.delete(orderId);
        this.#logger.child({orderId})
            .debug(`order worth $${usdValue} has been removed, new budget utilization: ${this.#spent} (${this.getBudgetUtilizationRate()}%)`)
    }

    getBudgetUtilizationRate(spent?: number): number {
        const rate = (spent || this.#spent) / this.budget * 100;
        return Number(rate.toFixed(2));
    }
}