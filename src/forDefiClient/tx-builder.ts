import crypto from 'crypto';
import { buffersAreEqual, ChainId, OrderDataWithId } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { OrderEstimation } from 'src/chain-common/order-estimator';
import { convertChainIdToChain, ForDefiClient } from 'src/forDefiClient/client';
import { InitTransactionBuilder } from 'src/processor';
import { FulfillTransactionBuilder } from 'src/chain-common/order-taker';
import { BatchUnlockTransactionBuilder } from 'src/processors/BatchUnlocker';
import { CreateTransactionRequest } from 'src/forDefiClient/create-transaction-requests';
import { SupportedChain } from 'src/config';
import { helpers } from '@debridge-finance/solana-utils';
import { ForDefiSigner } from './signer';

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

export interface FordefiAdapter {
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

enum ForDefiTransactionAction {
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

function safeDecodeNote<T extends ForDefiTransactionAction>(
  data: string,
  action: T,
): TransactionActionPayload<T> | undefined {
  try {
    const obj = JSON.parse(data);
    if ('action' in obj && 'payload' in obj) {
      if (action === obj.action && obj.action in ForDefiTransactionAction) {
        return obj.payload;
      }
    }
  } catch (e) {
    return undefined;
  }

  return undefined;
}

export class ForDefiTransactionBuilder
  implements InitTransactionBuilder, FulfillTransactionBuilder, BatchUnlockTransactionBuilder
{
  readonly #chain: ChainId;

  readonly #forDefiApi: ForDefiClient;

  readonly #forDefiSigner: ForDefiSigner;

  readonly #txAdapter: FordefiAdapter;

  constructor(
    chain: ChainId,
    forDefiApi: ForDefiClient,
    forDefiSigner: ForDefiSigner,
    adapter: FordefiAdapter,
  ) {
    this.#chain = chain;
    this.#forDefiApi = forDefiApi;
    this.#forDefiSigner = forDefiSigner;
    this.#txAdapter = adapter;
  }

  get fulfillAuthority() {
    return {
      address: this.#forDefiSigner.address,
      bytesAddress: this.#forDefiSigner.bytesAddress,
    };
  }

  get unlockAuthority() {
    return {
      address: this.#forDefiSigner.address,
      bytesAddress: this.#forDefiSigner.bytesAddress,
    };
  }

  getOrderFulfillTxSender(orderEstimation: OrderEstimation, logger: Logger) {
    return async () => {
      const req = await this.#txAdapter.getOrderFulfillTxSender(orderEstimation, logger);
      req.note = encodeNote<ForDefiTransactionAction.FulfillOrder>(
        ForDefiTransactionAction.FulfillOrder,
        {
          orderId: orderEstimation.order.orderId,
        },
      );

      // todo fetch all pages until the txn we are looking for is found
      const { transactions } = await this.#forDefiApi.listTransactions({
        size: 100,
        vault_ids: [req.vault_id],
        chains: [convertChainIdToChain(this.#chain as any as SupportedChain)],
        states: ['approved', 'pending'],
        sort_by: 'created_at_desc',
      });

      // find transaction which fulfills same order id
      const similarTxns = transactions.filter((transaction) => {
        const payload = safeDecodeNote<ForDefiTransactionAction.FulfillOrder>(
          transaction.note,
          ForDefiTransactionAction.FulfillOrder,
        );
        return (
          payload &&
          payload.orderId &&
          buffersAreEqual(
            helpers.hexToBuffer(payload.orderId),
            helpers.hexToBuffer(orderEstimation.order.orderId),
          )
        );
      });
      if (similarTxns.length > 0) {
        logger.debug(
          `found ${similarTxns.length} pending transactions fulfilling same order: ${similarTxns
            .map((tx) => `${tx.id} (${tx.state})`)
            .join(', ')}`,
        );
        return similarTxns[0].id;
      }

      const signedRequest = this.#forDefiSigner.sign(req);

      const resp = await this.#forDefiApi.createTransaction(signedRequest);
      return resp.id;
    };
  }

  getBatchOrderUnlockTxSender(orders: OrderDataWithId[], logger: Logger): () => Promise<string> {
    return async () => {
      const req = await this.#txAdapter.getBatchOrderUnlockTxSender(orders, logger);
      req.note = encodeNote<ForDefiTransactionAction.BatchOrderUnlock>(
        ForDefiTransactionAction.BatchOrderUnlock,
        { orderIds: orders.map((order) => helpers.bufferToHex(order.orderId)) },
      );
      const signedRequest = this.#forDefiSigner.sign(req);

      const idempotenceId = generateUUIDv4FromParams(this.#chain.toString(), req.note);
      const resp = await this.#forDefiApi.createTransaction(signedRequest, idempotenceId);
      return resp.id;
    };
  }

  async getInitTxSenders(logger: Logger) {
    const txs = await this.#txAdapter.getInitTxSenders(logger);
    return txs.map((req) => async () => {
      const signedRequest = this.#forDefiSigner.sign(req);

      const idempotenceId = generateUUIDv4FromParams(this.#chain.toString(), req.note);
      const resp = await this.#forDefiApi.createTransaction(signedRequest, idempotenceId);
      return resp.id;
    });
  }
}
