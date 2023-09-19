import { ChainId } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { assert } from '../errors';

type Thresholds = Array<
{
  minBlockConfirmations: number;
  tvlCap: number;
}
>

type BlockConfirmationRangeBudget = {
  currentTvl: number;
  tvlCap?: number;
  parent?: BlockConfirmationRangeBudget
  minBlockConfirmations: number;
  orders: Set<string>
}

type OrderRecord = {
  orderId: string;
  usdValue: number;
  confirmationBlocksCount: number;
}

// This controller simply keeps track of orders' worth that were attempted to be fulfilled
// while being non-finalized, to prevent TVL exceed the desired budget on a given chain
export class NonFinalizedOrdersBudgetController {

  readonly enabled: boolean;

  readonly #budget: BlockConfirmationRangeBudget;
  readonly #logger: Logger;
  readonly #orders = new Map<string, OrderRecord>();

  get spent(): number {
    return this.#budget.currentTvl;
  }

  constructor(
    public readonly chainId: ChainId,
    finalizationThreshold: number,
    thresholds: Thresholds,
    tvlCap: number,
    logger: Logger,
  ) {
    this.#logger = logger.child({
      service: NonFinalizedOrdersBudgetController.name,
      chainId,
    });

    this.enabled = 0 < Math.max(tvlCap, ...thresholds.map(t => t.tvlCap || 0));
    this.#budget = {
      currentTvl: 0,
      tvlCap,
      minBlockConfirmations: finalizationThreshold,
      orders: new Set,
      parent: this.getTopmostThreshold(thresholds)
    }

    let partialBudget: BlockConfirmationRangeBudget | undefined = this.#budget;
    do {
      this.#logger.debug(`initializing tvlCap for the range #${partialBudget.minBlockConfirmations}: $${partialBudget.tvlCap}`)
    } while ((partialBudget = partialBudget.parent));
  }

  shiftOrder(orderId: string, newConfirmationBlocksCount: number): void {
    let order = this.#orders.get(orderId);
    if (!order) return;

    const logger = this.#logger
      .child({ orderId });
    logger.debug(`shifting the order worth $${order.usdValue} from range #${order.confirmationBlocksCount} to #${newConfirmationBlocksCount}`)

    let partialBudget: BlockConfirmationRangeBudget | undefined = this.#budget;
    do {
      if (
          partialBudget.minBlockConfirmations < newConfirmationBlocksCount
          && partialBudget.minBlockConfirmations >= order.confirmationBlocksCount
      ) {
        assert(partialBudget.orders.has(orderId) === true, `order ${orderId} not found in block_confirmation #${partialBudget.minBlockConfirmations}`);

        partialBudget.currentTvl -= order.usdValue;
        partialBudget.orders.delete(orderId);

        logger.debug(NonFinalizedOrdersBudgetController.getRangeAsString(partialBudget))
      }
    } while ((partialBudget = partialBudget.parent));

    order.confirmationBlocksCount = newConfirmationBlocksCount;
  }

  finalizeOrder(orderId: string): void {
    this.removeOrder(orderId);
  }

  revokeOrder(orderId: string): void {
    this.removeOrder(orderId)
  }

  fits(orderId: string, confirmationBlocksCount: number, usdValue: number): boolean {
    if (!this.enabled || this.#orders.has(orderId)) {
      return true;
    }

    const logger = this.#logger
      .child({ orderId });
    logger.debug(`checking if the order worth $${usdValue} fits the non-finalized orders budget to the range #${confirmationBlocksCount}`)

    let partialBudget: BlockConfirmationRangeBudget | undefined = this.#budget;
    do {
      const potentialSpentBudgetInUSD = partialBudget.currentTvl + usdValue;
      if (partialBudget.tvlCap && potentialSpentBudgetInUSD > partialBudget.tvlCap) {
        const message = `order worth $${usdValue} does not fit non-finalized TVL budget: ${NonFinalizedOrdersBudgetController.getRangeAsString(partialBudget)}`;
        logger.debug(message);
        return false;
      }
    } while ((partialBudget = partialBudget.parent) && (partialBudget.minBlockConfirmations >= confirmationBlocksCount));

    return true;
  }

  addOrder(orderId: string, confirmationBlocksCount: number, usdValue: number): void {
      if (!this.enabled) {
      return;
    }

    // if order already registered, we must shift it to a higher level range
    if (this.#orders.has(orderId)) {
      return this.shiftOrder(orderId, confirmationBlocksCount);
    }

    const logger = this.#logger.child({ orderId });
    this.#orders.set(orderId, {
      orderId,
      usdValue,
      confirmationBlocksCount
    });
    logger.info(`adding order worth $${usdValue} to the range #${confirmationBlocksCount}`);

    let partialBudget: BlockConfirmationRangeBudget | undefined = this.#budget;
    do {
      assert(partialBudget.orders.has(orderId) === false, `order ${orderId} found in block_confirmation #${partialBudget.minBlockConfirmations}`);

      partialBudget.currentTvl += usdValue;
      partialBudget.orders.add(orderId);

      logger.debug(NonFinalizedOrdersBudgetController.getRangeAsString(partialBudget))
    } while ((partialBudget = partialBudget.parent) && (partialBudget.minBlockConfirmations >= confirmationBlocksCount));
  }

  private removeOrder(orderId: string) {
    let order = this.#orders.get(orderId);
    if (!order) return;

    const logger = this.#logger
      .child({ orderId });
    logger.info(`deleting the order worth $${order.usdValue} (previous range #${order.confirmationBlocksCount})`);
    this.#orders.delete(orderId);

    let partialBudget: BlockConfirmationRangeBudget | undefined = this.#budget;
    do {
      partialBudget.currentTvl -= order.usdValue;
      partialBudget.orders.delete(orderId);

      logger.debug(NonFinalizedOrdersBudgetController.getRangeAsString(partialBudget))
    } while ((partialBudget = partialBudget.parent) && (partialBudget.orders.has(orderId)));
  }

  private getTopmostThreshold(thresholds: Thresholds): BlockConfirmationRangeBudget | undefined {
    return thresholds
      .sort((t1, t2) => t1.minBlockConfirmations - t2.minBlockConfirmations)
      .map(t => (<BlockConfirmationRangeBudget>{
        currentTvl: 0,
        minBlockConfirmations: t.minBlockConfirmations,
        tvlCap: t.tvlCap || 0,
        orders: new Set,
        parent: undefined
      }))
      .reduce((prevValue, currValue) => {
        currValue.parent = prevValue
        return currValue
      })
  }

  private static getRangeAsString(tr: BlockConfirmationRangeBudget): string {
    return `TVL at block_confirmation #${tr.minBlockConfirmations}: $${tr.currentTvl} (cap: $${tr.tvlCap}, utilization: ${NonFinalizedOrdersBudgetController.getBudgetUtilizationRate(tr)}%, orders count: ${tr.orders.size})`
  }

  private static getBudgetUtilizationRate(tr: BlockConfirmationRangeBudget): number {
    if (!tr.tvlCap) return 0;

    const rate = (tr.currentTvl / tr.tvlCap) * 100;
    return Number(rate.toFixed(2));
  }
}
