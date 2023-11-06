import crypto from 'crypto';
import { ChainId, OrderDataWithId } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { helpers } from '@debridge-finance/solana-utils';
import { ForDefiSigner } from './signer';
import { OrderEstimation } from '../chain-common/order-estimator';
import { FulfillTransactionBuilder } from '../chain-common/order-taker';
import { InitTransactionBuilder } from '../processor';
import { BatchUnlockTransactionBuilder } from '../processors/BatchUnlocker';
import { ForDefiClient } from './client';
import { Authority } from '../interfaces';
import { CreateTransactionRequest } from './types/createTransaction';

// #region Utils

enum ForDefiTransactionAction {
  Init = 'Init',
  FulfillOrder = 'FulfillOrder',
  BatchOrderUnlock = 'BatchOrderUnlock',
}

type TransactionActionPayload<T extends ForDefiTransactionAction> = {
  attempt: number;
} & (T extends ForDefiTransactionAction.Init ? { rawNote: string } : {}) &
  (T extends ForDefiTransactionAction.FulfillOrder ? { orderId: string } : {}) &
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

function generateHash(...params: string[]): Buffer {
  const hash = crypto.createHash('sha256');
  hash.update(params.join('|'));
  return hash.digest();
}

// Convert the hash to a UUIDv4 format
function generateUUIDv4FromParams(...params: string[]): string {
  const hash = generateHash(...params);
  return [
    hash.slice(0, 4).toString('hex'),
    hash.slice(4, 6).toString('hex'),
    `4${hash.slice(6, 8).toString('hex').substring(1)}`,
    // eslint-disable-next-line no-bitwise -- Intentional, but better rewrite in the future
    ((parseInt(hash.slice(8, 9).toString('hex'), 16) & 0x0f) | 0x80).toString(16) +
      hash.slice(9, 10).toString('hex'),
    hash.slice(10, 16).toString('hex'),
  ].join('-');
}
// #endregion

export interface ForDefiTransactionBuilderAdapter extends Authority {
  getBatchOrderUnlockTxSender(
    orders: OrderDataWithId[],
    logger: Logger,
  ): Promise<CreateTransactionRequest>;
  getOrderFulfillTxSender(
    orderEstimation: OrderEstimation,
    logger: Logger,
  ): Promise<CreateTransactionRequest>;
  getInitTxSenders(logger: Logger): Promise<Array<CreateTransactionRequest>>;
}

export class ForDefiTransactionBuilder
  implements InitTransactionBuilder, FulfillTransactionBuilder, BatchUnlockTransactionBuilder
{
  readonly #chain: ChainId;

  readonly #forDefiApi: ForDefiClient;

  readonly #forDefiSigner: ForDefiSigner;

  readonly #txAdapter: ForDefiTransactionBuilderAdapter;

  constructor(
    chain: ChainId,
    forDefiApi: ForDefiClient,
    forDefiSigner: ForDefiSigner,
    adapter: ForDefiTransactionBuilderAdapter,
  ) {
    this.#chain = chain;
    this.#forDefiApi = forDefiApi;
    this.#forDefiSigner = forDefiSigner;
    this.#txAdapter = adapter;
  }

  get fulfillAuthority() {
    return {
      address: this.#txAdapter.address,
      bytesAddress: this.#txAdapter.bytesAddress,
    };
  }

  get unlockAuthority() {
    return {
      address: this.#txAdapter.address,
      bytesAddress: this.#txAdapter.bytesAddress,
    };
  }

  getOrderFulfillTxSender(orderEstimation: OrderEstimation, logger: Logger) {
    return async () => {
      const req = await this.#txAdapter.getOrderFulfillTxSender(orderEstimation, logger);
      return this.proposeTransaction<ForDefiTransactionAction.FulfillOrder>(
        req,
        logger,
        ForDefiTransactionAction.FulfillOrder,
        {
          attempt: 0,
          orderId: orderEstimation.order.orderId,
        },
      );
    };
  }

  getBatchOrderUnlockTxSender(orders: OrderDataWithId[], logger: Logger): () => Promise<string> {
    return async () => {
      const req = await this.#txAdapter.getBatchOrderUnlockTxSender(orders, logger);
      return this.proposeTransaction<ForDefiTransactionAction.BatchOrderUnlock>(
        req,
        logger,
        ForDefiTransactionAction.BatchOrderUnlock,
        {
          attempt: 0,
          orderIds: orders.map((order) => helpers.bufferToHex(order.orderId)),
        },
      );
    };
  }

  async getInitTxSenders(logger: Logger) {
    const txs = await this.#txAdapter.getInitTxSenders(logger);
    return txs.map(
      (req) => async () =>
        this.proposeTransaction<ForDefiTransactionAction.Init>(
          req,
          logger,
          ForDefiTransactionAction.Init,
          {
            attempt: 0,
            rawNote: req.note,
          },
        ),
    );
  }

  private async proposeTransaction<T extends ForDefiTransactionAction>(
    req: CreateTransactionRequest,
    logger: Logger,
    action: T,
    payload: TransactionActionPayload<T>,
  ) {
    let attempt = 0;
    do {
      req.note = encodeNote(action, {
        ...payload,
        attempt,
      });

      const signedRequest = this.#forDefiSigner.sign(req);
      const idempotenceId = generateUUIDv4FromParams(this.#chain.toString(), req.note);
      // eslint-disable-next-line no-await-in-loop -- Intentional: we must be sure created transaction is not aborted
      const resp = await this.#forDefiApi.createTransaction(signedRequest, idempotenceId);

      switch (resp.state) {
        case 'aborted':
        case 'error_signing':
        case 'error_pushing_to_blockchain':
        case 'mined_reverted':
        case 'completed_reverted':
        case 'canceling':
        case 'cancelled': {
          logger.debug(
            `tx ${resp.id} (at attempt=${attempt}) found with state=${resp.state}, retrying txn...`,
          );
          attempt++;
          break;
        }

        default: {
          return resp.id;
        }
      }
    } while (true);
  }
}
