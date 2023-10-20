import { Logger } from 'pino';
import { BatchUnlockTransactionBuilder } from '../processors/BatchUnlocker';
import { FulfillTransactionBuilder } from './order-taker';

export type TxHash = string;

export type TransactionSender = {
  (): Promise<TxHash>;
};

export interface TransactionBuilder
  extends FulfillTransactionBuilder,
    BatchUnlockTransactionBuilder {
  getInitTxSenders(logger: Logger): Promise<Array<TransactionSender>>;
}
