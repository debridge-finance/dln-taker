import { Logger } from 'pino';
import { assert } from '../errors';
import { PostponingReason, RejectionReason } from '../hooks/HookEnums';

import { CreatedOrder } from './order';
import { explainEstimation, OrderEstimation } from './order-estimator';
import { TransactionSender, TxHash } from './tx-builder';

export interface FulfillTransactionBuilder {
  getOrderFulfillTxSender(orderEstimation: OrderEstimation, logger: Logger): TransactionSender;
}

export type TakerShortCircuit = {
  postpone(postpone: PostponingReason, message: string, delay?: number): Promise<void>;
  reject(rejection: RejectionReason, message: string): Promise<void>;
};

export class CreatedOrderTaker {
  readonly #logger: Logger;

  constructor(
    private readonly order: CreatedOrder,
    logger: Logger,
  ) {
    this.#logger = logger.child({ service: CreatedOrderTaker.name, orderId: order.orderId });
  }

  async take(sc: TakerShortCircuit, transactionBuilder: FulfillTransactionBuilder) {
    this.#logger.debug('+ attempting to validate');
    const estimator = await this.order.getValidator(sc).validate();

    this.#logger.debug('+ attempting to estimate');
    const estimation = await estimator.getEstimation();

    if (estimation.isProfitable === false) {
      return sc.postpone(PostponingReason.NOT_PROFITABLE, await explainEstimation(estimation));
    }

    this.#logger.debug('+ attempting to fulfill');
    const fulfillTxHash = await this.attemptFulfil(transactionBuilder, estimation, sc);
    assert(typeof fulfillTxHash === 'string', 'should have raised an error');
    this.#logger.info(`✔ fulfill tx broadcasted, txhash: ${fulfillTxHash}`);

    // we add this order to the budget controller right before the txn is broadcasted
    // Mind that in case of an error (see the catch{} block below) we don't remove it from the
    // controller because the error may occur because the txn was stuck in the mempool and reside there
    // for a long period of time
    this.order.giveChain.throughput.addOrder(
      this.order.orderId,
      this.order.blockConfirmations,
      await this.order.getUsdValue(),
    );

    this.order.giveChain.TVLBudgetController.flushCache();

    this.order.executor.hookEngine.handleOrderFulfilled({
      orderId: this.order.orderId,
      order: this.order.orderData,
      txHash: fulfillTxHash,
    });

    return Promise.resolve();
  }

  private async attemptFulfil(
    transactionBuilder: FulfillTransactionBuilder,
    estimation: OrderEstimation,
    sc: TakerShortCircuit,
  ): Promise<TxHash | void> {
    try {
      return await transactionBuilder.getOrderFulfillTxSender(estimation, this.#logger)();
    } catch (e) {
      this.#logger.error(`fulfill tx failed: ${e}`);
      this.#logger.error(e);
      return sc.postpone(PostponingReason.FULFILLMENT_TX_FAILED, `${e}`);
    }
  }
}
