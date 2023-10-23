import { OrderDataWithId } from '@debridge-finance/dln-client';
import { helpers } from '@debridge-finance/solana-utils';
import { VersionedTransaction } from '@solana/web3.js';
import { Logger, LoggerOptions } from 'pino';
import { OrderEstimation } from 'src/chain-common/order-estimator';
import { IExecutor } from 'src/executor';
import {
  CreateSolanaRawTransactionRequest,
  CreateTransactionRequest,
} from 'src/forDefiClient/create-transaction-requests';
import { FordefiAdapter } from 'src/forDefiClient/tx-builder';
import { createBatchOrderUnlockTx } from './tx-generators/createBatchOrderUnlockTx';
import { createOrderFullfillTx } from './tx-generators/createOrderFullfillTx';

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

  constructor(vaultId: string, executor: IExecutor) {
    this.#vaultId = vaultId;
    this.#executor = executor;
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
    return this.convert(versionedTx, note);
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
    return this.convert(versionedTx, note);
  }

  // eslint-disable-next-line class-methods-use-this -- Required by the interface
  getInitTxSenders(): Promise<CreateTransactionRequest[]> {
    throw new Error('Method not supported, use separate PK authority.');
  }

  private convert(_tx: VersionedTransaction, note: string): CreateSolanaRawTransactionRequest {
    // here is where Solana's VersionedTransaction must be repacked
    // feel free to introduce a separate class for conversion, and cover it with tests
    const req: CreateSolanaRawTransactionRequest = {
      vault_id: this.#vaultId,
      note,
      signer_type: 'api_signer',
      type: 'solana_transaction',
      details: {
        type: 'solana_raw_transaction',
        chain: 'solana_mainnet',
        version: 'legacy', // <!-- legacy | v0
        instructions: [], // <!--
        accounts: [], // <!--
        address_table_lookups: [], // <!--
      },
    };

    return req;
  }
}
