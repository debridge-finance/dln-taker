import crypto from 'crypto';
import { ChainId, OrderDataWithId } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { OrderEstimation } from 'src/chain-common/order-estimator';
import { ForDefiClient } from 'src/forDefiClient/client';
import { InitTransactionBuilder } from 'src/processor';
import { FulfillTransactionBuilder } from 'src/chain-common/order-taker';
import { BatchUnlockTransactionBuilder } from 'src/processors/BatchUnlocker';
import { CreateTransactionRequest } from 'src/forDefiClient/create-transaction-requests';
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

      // const transactions = await this.#forDefiApi.getTransactions({
      //   vaultId: this.#vaultId,
      //   chain: this.#chain.toString(),
      //   initiator: this.#forDefiSigner.address,
      //   states: ['approved', 'waiting_for_approval']
      // });

      // if has_any for the given order_id - do not publish new txn

      const signedRequest = this.#forDefiSigner.sign(req);

      const resp = await this.#forDefiApi.createTransaction(signedRequest);
      return resp.id;
    };
  }

  getBatchOrderUnlockTxSender(orders: OrderDataWithId[], logger: Logger): () => Promise<string> {
    return async () => {
      const req = await this.#txAdapter.getBatchOrderUnlockTxSender(orders, logger);
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
