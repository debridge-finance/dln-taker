import pino from 'pino';
import assert from 'assert';
import { ChainId } from '@debridge-finance/dln-client';
import { ThroughputController } from '../src/processors/throughput';

describe('NonFinalizedOrdersBudgetController', () => {
  const logger = pino({
    // level: 'debug',
  });
  const controller = new ThroughputController(
    ChainId.Arbitrum,
    [
      {
        maxFulfillThroughputUSD: 100,
        minBlockConfirmations: 1,
        throughputTimeWindowSec: 0.3,
      },
      {
        maxFulfillThroughputUSD: 1000,
        minBlockConfirmations: 10,
        throughputTimeWindowSec: 0.2,
      },
      {
        maxFulfillThroughputUSD: 0,
        minBlockConfirmations: 100,
        throughputTimeWindowSec: 0,
      },
    ],
    logger,
  );

  describe('validateOrder', () => {
    it('check throughout', async () => {
      assert.equal(controller.isThrottled('1', 1, 100), false);
      assert.equal(controller.isThrottled('1', 1, 101), true);

      assert.equal(controller.isThrottled('2', 2, 100), false);
      assert.equal(controller.isThrottled('2', 2, 101), true);

      assert.equal(controller.isThrottled('2', 9, 100), false);
      assert.equal(controller.isThrottled('2', 9, 101), true);

      assert.equal(controller.isThrottled('10', 10, 1000), false);
      assert.equal(controller.isThrottled('10', 10, 1001), true);

      controller.addOrder('1', 1, 99);
      assert.equal(controller.isThrottled('2', 1, 1), false);
      assert.equal(controller.isThrottled('2', 1, 2), true);

      assert.equal(controller.isThrottled('2', 2, 1), false);
      assert.equal(controller.isThrottled('2', 2, 2), true);

      assert.equal(controller.isThrottled('2', 9, 1), false);
      assert.equal(controller.isThrottled('2', 9, 2), true);

      assert.equal(controller.isThrottled('2', 10, 1000), false);
      assert.equal(controller.isThrottled('2', 10, 1001), true);
    });

    it('check automation', async () => {
      controller.addOrder('1', 1, 99);
      assert.equal(controller.isThrottled('2', 1, 100), true);

      // wait 0.3s, as per first range
      await new Promise((resolve) => {
        setTimeout(resolve, 300);
      });
      assert.equal(controller.isThrottled('2', 1, 100), false);
    });

    it('check removal', async () => {
      controller.addOrder('1', 1, 99);
      controller.removeOrder('1');
      assert.equal(controller.isThrottled('2', 1, 100), false);
    });

    it('must use topmost range if empty', async () => {
      assert.equal(controller.isThrottled('2', 100, 10_000), false);
    });
  });
});
