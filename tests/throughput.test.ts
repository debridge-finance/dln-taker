import pino from 'pino';
import assert from 'assert';
import { ChainId } from '@debridge-finance/dln-client';
import { ThroughputController } from '../src/processors/throughput';

describe('NonFinalizedOrdersBudgetController', () => {
  const logger = pino({});
  const controller = new ThroughputController(
    ChainId.Arbitrum,
    [
      {
        maxFulfillThroughputUSD: 100,
        minBlockConfirmations: 1,
        throughputTimeWindowSec: 0.3,
      },
      {
        maxFulfillThroughputUSD: 100,
        minBlockConfirmations: 2,
        throughputTimeWindowSec: 0.2,
      },
    ],
    logger,
  );

  describe('validateOrder', () => {
    it('check throughout', async () => {
      assert.equal(controller.isThrottled('1', 1, 99), false);
      assert.equal(controller.isThrottled('1', 1, 100), false);
      assert.equal(controller.isThrottled('1', 1, 101), true);
      assert.equal(controller.isThrottled('1', 2, 100), false);
      assert.equal(controller.isThrottled('1', 3, 101), false);

      controller.addOrder('1', 1, 99);
      assert.equal(controller.isThrottled('2', 1, 1), false);
      assert.equal(controller.isThrottled('2', 1, 2), true);
      assert.equal(controller.isThrottled('2', 2, 100), false);
    });

    it('check automation', async () => {
      controller.addOrder('1', 1, 99);

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
  });
});
