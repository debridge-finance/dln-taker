import { OrderDataWithId } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { OrderEstimation } from './order-estimator';

type TransactionSender = {
  (): Promise<string>;
};

export interface TransactionBuilder {
  getOrderFulfillTxSender(orderEstimation: OrderEstimation, logger: Logger): TransactionSender;
  getBatchOrderUnlockTxSender(orders: Array<OrderDataWithId>, logger: Logger): TransactionSender;
  getInitTxSenders(logger: Logger): Promise<Array<TransactionSender>>;
}
