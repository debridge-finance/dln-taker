import pino from 'pino';
import assert from 'assert';
import { ChainId } from '@debridge-finance/dln-client';
import { NonFinalizedOrdersBudgetController } from '../src/processors/NonFinalizedOrdersBudgetController';

describe('NonFinalizedOrdersBudgetController', () => {
  const logger = pino();
  const thresholds = [
    {
      minBlockConfirmations: 1,
      tvlCap: 100,
    },
    {
      minBlockConfirmations: 2,
      tvlCap: 0,
    },
    {
      minBlockConfirmations: 3,
      tvlCap: 200,
    },
    {
      minBlockConfirmations: 6,
      tvlCap: 300,
    },
  ]
  const controller = new NonFinalizedOrdersBudgetController(ChainId.Arbitrum, 12, thresholds, 1000, logger);

  describe('validateOrder', () => {
    it('should confirm orders', () => {
      assert.equal(controller.fits('1', 1, 50), true);

      controller.addOrder('1', 1, 50);
      assert.equal(controller.spent, 50);

      controller.addOrder('2', 2, 100);
      assert.equal(controller.fits('2', 2, 100), true);
      assert.equal(controller.spent, 150);
    });

    it('should confirm if duplicated', () => {
      assert.equal(controller.fits('1', 1, 50), true);

      controller.addOrder('1', 1, 50);
      assert.equal(controller.spent, 150);
    });

    it('should not accept order if out of budget (1 confirmation)', () => {
      assert.equal(controller.fits('3', 1, 51), false);
      assert.equal(controller.spent, 150);
    });

    it('should not accept order if out of budget (2 confirmations)', () => {
      assert.equal(controller.fits('3', 2, 101), false);
      assert.equal(controller.spent, 150);
    });

    it('should not accept order if out of budget (3 confirmations)', () => {
      assert.equal(controller.fits('3', 3, 301), false);
      assert.equal(controller.spent, 150);
    });

    it('should not accept order if out of budget (12 confirmations)', () => {
      assert.equal(controller.fits('3', 4, 851), false);
      assert.equal(controller.spent, 150);
    });

    it('should shift the order to an upper range', () => {
      controller.shiftOrder('1', 2);
      assert.equal(controller.spent, 150);

      assert.equal(controller.fits('3', 1, 50), true);
      controller.addOrder('3', 1, 50);
      assert.equal(controller.spent, 200);
    })

    it('should sequentially shift the same order', () => {
      controller.shiftOrder('2', 4);
      controller.shiftOrder('2', 5);
    })

    it('should remove order and reduce the budget to 100%', () => {
      controller.finalizeOrder('2');
      assert.equal(controller.spent, 100);
    });
  });
});
