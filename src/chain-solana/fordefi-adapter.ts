import { ChainId, OrderDataWithId } from '@debridge-finance/dln-client';
import { helpers } from '@debridge-finance/solana-utils';
import { Logger, LoggerOptions } from 'pino';
import { createBatchOrderUnlockTx } from './tx-generators/createBatchOrderUnlockTx';
import { createOrderFullfillTx } from './tx-generators/createOrderFullfillTx';
import { SolanaForDefiConverter } from './fordefi-converter';
import { OrderEstimation } from '../chain-common/order-estimator';
import { IExecutor } from '../executor';
import { CreateTransactionRequest } from '../forDefiClient/create-transaction-requests';
import { FordefiAdapter } from '../forDefiClient/tx-builder';

const enum ForDefiTransactionAction {
  FulfillOrder = 'FulfillOrder',
  BatchOrderUnlock = 'BatchOrderUnlock',
}

type TransactionActionPayload<T extends ForDefiTransactionAction> =
  {} & (T extends ForDefiTransactionAction.FulfillOrder ? { orderId: string } : {}) &
    (T extends ForDefiTransactionAction.BatchOrderUnlock ? { orderIds: string[] } : {});

function encodeNote<T extends ForDefiTransactionAction>(
  action: T,
  payload: TransactionActionPayload<T>,
) {
  return JSON.stringify({
    action,
    payload,
  });
}

export class SolanaForDefiTransactionAdapter implements FordefiAdapter {
  readonly #vaultId: string;

  readonly #executor: IExecutor;

  readonly #converter: SolanaForDefiConverter;

  constructor(vaultId: string, executor: IExecutor) {
    this.#vaultId = vaultId;
    this.#executor = executor;
    this.#converter = new SolanaForDefiConverter(
      this.#executor.client.getConnection<ChainId.Solana>(ChainId.Solana),
    );
  }

  async getBatchOrderUnlockTxSender(
    orders: OrderDataWithId[],
    logger: Logger<LoggerOptions>,
  ): Promise<CreateTransactionRequest> {
    const versionedTx = await createBatchOrderUnlockTx(this.#executor, orders, logger);
    const note = encodeNote<ForDefiTransactionAction.BatchOrderUnlock>(
      ForDefiTransactionAction.BatchOrderUnlock,
      { orderIds: orders.map((order) => helpers.bufferToHex(order.orderId)) },
    );
    return this.#converter.convert(versionedTx, note, this.#vaultId);
  }

  async getOrderFulfillTxSender(
    orderEstimation: OrderEstimation,
    logger: Logger<LoggerOptions>,
  ): Promise<CreateTransactionRequest> {
    const versionedTx = await createOrderFullfillTx(orderEstimation, logger);
    const note = encodeNote<ForDefiTransactionAction.FulfillOrder>(
      ForDefiTransactionAction.FulfillOrder,
      {
        orderId: orderEstimation.order.orderId,
      },
    );
    return this.#converter.convert(versionedTx, note, this.#vaultId);
  }

  // eslint-disable-next-line class-methods-use-this -- Required by the interface
  getInitTxSenders(): Promise<CreateTransactionRequest[]> {
    throw new Error('Method not supported, use separate PK authority.');
  }
}
