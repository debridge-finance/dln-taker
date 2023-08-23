import pino from 'pino';
import assert from 'assert';
import { ChainId } from '@debridge-finance/dln-client';
import { NonFinalizedOrdersBudgetController } from '../src/processors/NonFinalizedOrdersBudgetController';

describe('NonFinalizedOrdersBudgetController', () => {
  const logger = pino();
  const controller = new NonFinalizedOrdersBudgetController(ChainId.Arbitrum, 100, logger);

  describe('validateOrder', () => {
    it('should confirm orders', () => {
      controller.addOrder('1', 10);
      assert.equal(controller.isFitsBudget('1', 10), true);
      assert.equal(controller.spent, 10);

      controller.addOrder('2', 90);
      assert.equal(controller.isFitsBudget('2', 90), true);
      assert.equal(controller.spent, 100);
    });

    it('should confirm order if duplicated', () => {
      assert.equal(controller.isFitsBudget('2', 90), true);
      assert.equal(controller.spent, 100);
    });

    it('should not accept order if out of budget', () => {
      assert.equal(controller.isFitsBudget('3', 10), false);
      assert.equal(controller.spent, 100);
    });

    it('should overflow the budget to 110%', () => {
      controller.addOrder('3', 10);
      assert.equal(controller.spent, 110);
      assert.equal(controller.isFitsBudget('4', 10), false);
    });

    it('should remove order and reduce the budget to 100%', () => {
      controller.removeOrder('3');
      assert.equal(controller.spent, 100);
      assert.equal(controller.isFitsBudget('4', 10), false);
    });

    it('should remove order and reduce the budget to 90%', () => {
      controller.removeOrder('1');
      assert.equal(controller.spent, 90);
      assert.equal(controller.isFitsBudget('4', 10), true);
    });
  });
});
