import { ChainId } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { assert } from '../errors';
import { OrderId } from './base';

type Threshold = {
  minBlockConfirmations: number;
  maxFulfillThroughputUSD: number;
  throughputTimeWindowSec: number;
};

type Metric = Readonly<Threshold> & {
  currentlyLocked: number;
  orders: Set<OrderId>;
};

type OrderRecord = {
  orderId: OrderId;
  usdValue: number;
  confirmationBlocksCount: number;
  timer: ReturnType<typeof setTimeout>;
  metric: Metric;
};

// This controller simply keeps track of orders' worth that were attempted to be fulfilled
// while being non-finalized, to prevent TVL exceed the desired budget on a given chain
export class ThroughputController {
  readonly enabled: boolean;

  readonly #metrics: Array<Metric>;

  readonly #logger: Logger;

  readonly #orders = new Map<string, OrderRecord>();

  constructor(
    public readonly chainId: ChainId,
    thresholds: Array<Threshold>,
    logger: Logger,
  ) {
    this.#logger = logger.child({
      service: ThroughputController.name,
      chainId,
    });

    this.#metrics = thresholds
      .filter(
        (threshold) =>
          threshold.maxFulfillThroughputUSD > 0 &&
          threshold.throughputTimeWindowSec > 0 &&
          threshold.minBlockConfirmations,
      )
      .sort(
        (thresholdA, thresholdB) =>
          thresholdA.minBlockConfirmations - thresholdB.minBlockConfirmations,
      )
      .map((threshold) => ({
        ...threshold,
        currentlyLocked: 0,
        orders: new Set(),
      }));
    this.enabled = this.#metrics.length > 0;

    for (const threshold of this.#metrics) {
      this.#logger.debug(
        `initializing maxFulfillThroughputUSD for the range <=${threshold.minBlockConfirmations}: $${threshold.maxFulfillThroughputUSD}, limit: ${threshold.throughputTimeWindowSec}s`,
      );
    }

    this.#logger.debug(
      `${ThroughputController.name} state: ${this.enabled ? 'enabled' : 'disabled'}`,
    );
  }

  fitsThroughout(orderId: string, confirmationBlocksCount: number, usdValue: number): boolean {
    if (!this.enabled) {
      return true;
    }

    const metric = this.getMetric(confirmationBlocksCount);
    if (!metric) {
      return true;
    }

    const logger = this.#logger.child({ orderId });
    logger.debug(
      `checking if the order worth $${usdValue} and ${confirmationBlocksCount} block confirmations fits the throughput range #${metric.minBlockConfirmations}`,
    );

    const potentialSpentBudgetInUSD = metric.currentlyLocked + usdValue;
    if (metric.maxFulfillThroughputUSD < potentialSpentBudgetInUSD) {
      const message = `order worth $${usdValue} does not fit non-finalized TVL budget: ${ThroughputController.getRangeAsString(
        metric,
      )}`;
      logger.debug(message);
      return false;
    }

    return true;
  }

  addOrder(orderId: string, confirmationBlocksCount: number, usdValue: number): void {
    if (!this.enabled) {
      return;
    }

    const metric = this.getMetric(confirmationBlocksCount);
    if (!metric) return;

    // we must sync order existence, because it may jump from one range to another
    this.removeOrder(orderId);

    metric.orders.add(orderId);
    metric.currentlyLocked += usdValue;
    const timer = setTimeout(this.getTimerCallback(orderId), metric.throughputTimeWindowSec * 1000);

    const logger = this.#logger.child({ orderId });
    this.#orders.set(orderId, {
      orderId,
      usdValue,
      confirmationBlocksCount,
      timer,
      metric,
    });
    logger.debug(
      `order worth $${usdValue} added to the throughput range #${
        metric.minBlockConfirmations
      } at the range #${confirmationBlocksCount}; ${ThroughputController.getRangeAsString(metric)}`,
    );
  }

  private getTimerCallback(orderId: OrderId) {
    return () => {
      this.removeOrder(orderId);
    };
  }

  removeOrder(orderId: string) {
    const order = this.#orders.get(orderId);
    if (!order) return;

    const logger = this.#logger.child({ orderId });
    this.#orders.delete(orderId);

    const { metric } = order;
    assert(metric.orders.has(orderId), `order ${orderId} unexpectedly missing in the range`);
    metric.orders.delete(orderId);
    metric.currentlyLocked -= order.usdValue;

    logger.debug(
      `order worth $${order.usdValue} removed from the the throughput range #${
        metric.minBlockConfirmations
      }; ${ThroughputController.getRangeAsString(metric)}`,
    );
  }

  private getMetric(confirmationBlocksCount: number): Metric | undefined {
    return this.#metrics.find((metric) => metric.minBlockConfirmations >= confirmationBlocksCount);
  }

  private static getRangeAsString(tr: Metric): string {
    const rate = (tr.currentlyLocked / tr.maxFulfillThroughputUSD) * 100;
    return `TVL at block_confirmation #${tr.minBlockConfirmations}: $${tr.currentlyLocked} (cap: $${
      tr.maxFulfillThroughputUSD
    }, utilization: ${rate.toFixed(2)}%, orders count: ${tr.orders.size})`;
  }
}
