import {UnconfirmedOrdersBudgetController} from "../src/processors/UnconfirmedOrdersBudgetController";
import pino from "pino";
import assert from "assert";

describe('UnconfirmedOrdersBudgetController', () => {
  const logger = pino();
  const controller = new UnconfirmedOrdersBudgetController(100);

  describe('validateOrder', () => {
    it('should confirm orders', () => {
      assert.equal(controller.validateAndAddOrder('1', 10, logger), true);
      assert.equal(controller.validateAndAddOrder('2', 90, logger), true);
    });

    it('should unconfirm orders', () => {
      try {
        controller.validateAndAddOrder('3', 1000, logger);
      } catch (e) {
        const error = e as Error;
        assert.equal(error.message, 'Order with usd worth 1000 is out of budget 100(spent 100)');
      }
    });
  });

  describe('removeOrder', () => {
    it('should delete orders', () => {
      controller.removeOrder('1', logger);
      controller.removeOrder('2', logger);
      assert.equal(controller.validateOrder('1', 10, logger), true);
    });
  });
});
