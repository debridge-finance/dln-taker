import { OrderDataWithId } from '@debridge-finance/dln-client';
import { Logger, LoggerOptions } from 'pino';
import { InitTransactionBuilder } from '../processor';
import { BatchUnlockTransactionBuilder } from '../processors/BatchUnlocker';
import { OrderEstimation } from './order-estimator';
import { FulfillTransactionBuilder } from './order-taker';

export type TxHash = string;

export type TransactionSender = {
  (): Promise<TxHash>;
};

export class TransactionBuilder
  implements FulfillTransactionBuilder, BatchUnlockTransactionBuilder, InitTransactionBuilder
{
  constructor(
    private readonly initTransactionBuilder: InitTransactionBuilder,
    private readonly fulfillTransactionBuilder: FulfillTransactionBuilder,
    private readonly unlockTransactionBuilder: BatchUnlockTransactionBuilder,
  ) {}

  get fulfillAuthority() {
    return this.fulfillTransactionBuilder.fulfillAuthority;
  }

  get unlockAuthority() {
    return this.unlockTransactionBuilder.unlockAuthority;
  }

  getOrderFulfillTxSender(
    orderEstimation: OrderEstimation,
    logger: Logger<LoggerOptions>,
  ): TransactionSender {
    return this.fulfillTransactionBuilder.getOrderFulfillTxSender(orderEstimation, logger);
  }

  getBatchOrderUnlockTxSender(
    orders: OrderDataWithId[],
    logger: Logger<LoggerOptions>,
  ): TransactionSender {
    return this.unlockTransactionBuilder.getBatchOrderUnlockTxSender(orders, logger);
  }

  getInitTxSenders(logger: Logger<LoggerOptions>): Promise<TransactionSender[]> {
    return this.initTransactionBuilder.getInitTxSenders(logger);
  }
}
