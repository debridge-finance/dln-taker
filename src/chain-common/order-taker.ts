import { Logger } from 'pino';
import { PostponingReason, RejectionReason } from 'src/hooks/HookEnums';

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
    this.#logger.info('starting order evaluation');

    this.#logger.info('+ attempting to validate');
    const estimator = await this.order.getValidator(sc).validate();

    this.#logger.info('+ attempting to estimate');
    const estimation = await estimator.getEstimation();

    if (estimation.isProfitable) {
      this.#logger.info('✔️ order is profitable');
    } else {
      this.#logger.info('𐄂 order is not profitable');
      // print nice msg and return
      return sc.postpone(PostponingReason.NOT_PROFITABLE, await explainEstimation(estimation));
    }

    this.#logger.info('+ attempting to fulfill');
    try {
      await this.fulfill(transactionBuilder, estimation);
    } catch (e) {
      const message = `𐄂 fulfill tx failed: ${e}`;
      this.#logger.error(message);
      this.#logger.error(e);
      return sc.postpone(PostponingReason.FULFILLMENT_TX_FAILED, message);
    }

    return Promise.resolve();
  }

  async fulfill(
    transactionBuilder: FulfillTransactionBuilder,
    estimation: OrderEstimation,
  ): Promise<TxHash> {
    const fulfillTxHash = await transactionBuilder.getOrderFulfillTxSender(
      estimation,
      this.#logger,
    )();
    this.#logger.info(`✔️ fulfill tx broadcasted, txhash: ${fulfillTxHash}`);

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

    return fulfillTxHash;
  }
}
