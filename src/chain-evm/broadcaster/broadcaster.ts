import { Logger } from 'pino';
import Web3 from 'web3';
import { getBoolean, getInt } from '../../env-utils';
import { assert } from '../../errors';
import {
  EIP1559GasExtension,
  IEvmFeeManager,
  LegacyGasExtension,
  TransactionTemplate,
} from '../fees/manager';
import { GasCategory } from '../fees/types';

/**
 * Indicates whether broadcast must trigger poller immediately after txHash is received, or after at least
 * an avg. block speed. Necessary for development and local node tests
 */
const EVM_BROADCAST_IMMEDIATE_POLL = getBoolean(
  'EVM_BROADCAST_IMMEDIATE_POLL',
  getBoolean('DLN_TAKER_LOCAL_MODE', false) === true,
);

type InputTx = {
  from: string;
  data: string;
  to: string;
  value?: string;
};

enum EvmRpcError {
  NonceTooLow,
  TransactionUnderpriced,
  Stuck,
  Other,
}

function stringToError(error: any): EvmRpcError {
  const stringifiedError = `${error}`;
  if (stringifiedError.match(/too low/i) && stringifiedError.match(/nonce/i))
    return EvmRpcError.NonceTooLow;
  if (stringifiedError.match(/underpriced/i) || stringifiedError.match(/too low/i))
    return EvmRpcError.TransactionUnderpriced;
  if (stringifiedError.match(/not mined/i)) return EvmRpcError.Stuck;
  // else if (stringifiedError.match(/execution reverted/i)) return Error.EstimationReverted;
  // else if (stringifiedError.match(/Transaction has been reverted by the EVM/i)) return Error.Reverted;
  return EvmRpcError.Other;
}

type PopulatedTxn = TransactionTemplate & (EIP1559GasExtension | LegacyGasExtension);

type Signer = (transactionConfig: PopulatedTxn) => Promise<string>;

export type TransactionBroadcasterOpts = {
  sendMaxAttempts: number;
  pollingIntervalMs: number;
  pollingMaxAttempts: number;
};

const defaultSendMaxAttempts = getInt('EVM_BROADCASTER__SEND_MAX_ATTEMPTS', 4);
const defaultPollingMaxAttempts = getInt('EVM_BROADCASTER__POLLING_MAX_ATTEMPTS', 6);

export function getSuggestedOpts(avgBlockSpeed: number): TransactionBroadcasterOpts {
  return {
    sendMaxAttempts: defaultSendMaxAttempts,
    pollingIntervalMs: Math.round(avgBlockSpeed * 1000),
    pollingMaxAttempts: defaultPollingMaxAttempts,
  };
}

type Web3TransactionReceipt = Awaited<ReturnType<Web3['eth']['getTransactionReceipt']>>;

type Broadcast = {
  tx: PopulatedTxn;
  broadcastId: number;
  attempt: number;
  hash?: string;
  broadcastFailed?: boolean;
};

export class TransactionBroadcaster {
  #startedAt?: Date;

  readonly #inputTx: Readonly<InputTx>;

  readonly #cappedFee?: bigint;

  readonly #feeManager: IEvmFeeManager;

  readonly #signer: Signer;

  readonly #connection: Web3;

  readonly #logger: Logger;

  readonly #id: number;

  readonly #opts: TransactionBroadcasterOpts;

  readonly #broadcasts: Array<Broadcast> = [];

  constructor(
    tx: InputTx,
    cappedFee: bigint | undefined,
    connection: Web3,
    manager: IEvmFeeManager,
    signer: Signer,
    logger: Logger,
    opts?: Partial<TransactionBroadcasterOpts>,
  ) {
    this.#inputTx = tx;
    this.#cappedFee = cappedFee;
    this.#connection = connection;
    this.#feeManager = manager;
    this.#signer = signer;
    this.#id = new Date().getTime();
    this.#logger = logger.child({ [TransactionBroadcaster.name]: this.#id });
    this.#opts = { ...getSuggestedOpts(12), ...(opts || {}) };
  }

  async broadcastAndWait(): Promise<Web3TransactionReceipt> {
    assert(!this.#startedAt, `sending already initiated (${this.#id})`);
    this.#startedAt = new Date();

    const txReceipt = await this.run();

    const elapsedTime = new Date().getTime() - this.#startedAt.getTime();

    this.#logger.info(
      `tx ${txReceipt.transactionHash} confirmed at block #${txReceipt.blockNumber} at attempt #${
        this.#broadcastAttemptsCount
      } within ${elapsedTime / 1000}s, status: ${txReceipt.status}`,
    );
    return txReceipt;
  }

  get #broadcastAttemptsCount() {
    return this.#broadcasts.length;
  }

  private async run(): Promise<Web3TransactionReceipt> {
    const template = await this.getTransactionTemplate();
    return this.pushTransaction(template).catch((e) => this.getAnyReceipt(e));
  }

  private async getPromise(tx: PopulatedTxn): Promise<Web3TransactionReceipt> {
    const broadcast = {
      tx,
      broadcastId: new Date().getTime(),
      attempt: this.#broadcastAttemptsCount + 1,
    };
    if (broadcast.attempt > this.#opts.sendMaxAttempts) {
      this.#logger.debug(
        `no more attempts (${this.#broadcastAttemptsCount}/${this.#opts.sendMaxAttempts})`,
      );
      return Promise.reject(new Error(`max attempts to send a txn reached`));
    }
    this.#broadcasts.push(broadcast);

    return new Promise((resolve, reject) => {
      this.signAndBroadcast(broadcast).then(
        (hash) => this.handleBroadcastSuccess(hash, broadcast).then(resolve, reject),
        (err) => this.handleBroadcastRejection(err, broadcast).then(resolve, reject),
      );
    });
  }

  private pushTransaction(template: TransactionTemplate) {
    return this.#feeManager.populateTx(template, this.#cappedFee).then((tx) => this.getPromise(tx));
  }

  private pushReplacementTransaction(broadcast: Broadcast): Promise<Web3TransactionReceipt> {
    const isLastAttempt = this.#opts.sendMaxAttempts === broadcast.attempt + 1;
    const desiredGasCategory = isLastAttempt ? GasCategory.AGGRESSIVE : undefined;
    return this.#feeManager
      .populateReplacementTx(broadcast.tx, broadcast.tx, this.#cappedFee, desiredGasCategory)
      .then((tx) => this.getPromise(tx));
  }

  private handleBroadcastSuccess(
    txHash: string,
    broadcast: Broadcast,
  ): Promise<Web3TransactionReceipt> {
    return new Promise((resolve) => {
      let pollingAttempt = 0;

      // use setTimeout rather than setInterval is because we want to perform the first check immediately
      const poller = () => {
        pollingAttempt++;
        this.#logger.debug(
          `broadcast#${broadcast.attempt} poll#${pollingAttempt} polling txHash ${txHash}`,
        );

        const scheduleNextPoll = () => {
          if (pollingAttempt >= this.#opts.pollingMaxAttempts) {
            this.#logger.debug(
              `broadcast#${broadcast.attempt} poll#${pollingAttempt} txHash#${txHash}: poller reached max attempts (${this.#opts.pollingMaxAttempts}), trying to replace txn`,
            );
            resolve(this.pushReplacementTransaction(broadcast));
          } else setTimeout(poller, this.#opts.pollingIntervalMs);
        };

        this.getTransactionReceipt(txHash).then(
          (txReceipt) => {
            this.#logger.debug(
              `broadcast#${broadcast.attempt} poll#${pollingAttempt} txHash#${txHash}: ${txReceipt.status}`,
            );
            resolve(txReceipt);
          },
          (err) => {
            this.#logger.debug(
              `broadcast#${broadcast.attempt} poll#${pollingAttempt} txHash#${txHash}: returned error: ${err}`,
            );
            scheduleNextPoll();
          },
        );
      };

      // call the check right away!
      if (EVM_BROADCAST_IMMEDIATE_POLL) poller();
      else setTimeout(poller, this.#opts.pollingIntervalMs);
    });
  }

  private getTransactionReceipt(txHash: string): Promise<Web3TransactionReceipt> {
    return this.rpcCall<Web3TransactionReceipt>('eth_getTransactionReceipt', [txHash]).then(
      (txReceipt) => {
        if (!txReceipt) return Promise.reject(new Error(`receipt for ${txHash} not found`));

        const trulys = [true, 'true', 1, '1', '0x1', 0x1];
        const falsys = [false, 'false', 0, '0', '0x0', 0x0];
        if (trulys.includes(txReceipt.status)) {
          return Promise.resolve({
            ...txReceipt,
            status: true,
          });
        }
        if (falsys.includes(txReceipt.status)) {
          return Promise.resolve({
            ...txReceipt,
            status: false,
          });
        }

        return Promise.reject(
          new Error(
            `unexpected receipt status: ${txReceipt.status} (raw data: ${JSON.stringify(
              txReceipt,
            )})`,
          ),
        );
      },
    );
  }

  private handleBroadcastRejection(e: any, broadcast: Broadcast) {
    const error = stringToError(e);
    if (error === EvmRpcError.NonceTooLow) {
      return this.getTransactionTemplate(broadcast.tx.nonce + 1).then((template) =>
        this.pushTransaction(template),
      );
    }
    if (error === EvmRpcError.TransactionUnderpriced) {
      return this.pushReplacementTransaction(broadcast);
    }
    if (error === EvmRpcError.Stuck) {
      return this.pushReplacementTransaction(broadcast);
    }

    return Promise.reject(e);
  }

  private getAnyReceipt(previousError: any): Promise<Web3TransactionReceipt> {
    this.#logger.debug(
      `trying to find if previously broadcasted txns were included because new attempt failed: ${previousError}`,
    );

    const previousBroadcastedTxn = this.#broadcasts
      .slice(0, -1)
      .map(({ hash }) => hash)
      .filter((hash) => hash !== undefined);

    if (previousBroadcastedTxn.length === 0) return Promise.reject(previousError);

    // check if previous txn has been included in the blockchain, because previous inclusion may be the reason
    // our new attempt has failed
    this.#logger.debug(
      `checking ${previousBroadcastedTxn.length} txns: ${previousBroadcastedTxn.join(', ')}`,
    );

    return Promise.allSettled(
      previousBroadcastedTxn.map((hash) => this.getTransactionReceipt(hash!)),
    ).then(
      (promises) => {
        const anySuccessful = promises.find(
          (promise) => promise.status === 'fulfilled' && promise.value.status === true,
        );
        if (anySuccessful && anySuccessful.status === 'fulfilled') {
          this.#logger.debug(`found a successful txn ${anySuccessful.value.transactionHash}`);
          return Promise.resolve(anySuccessful.value);
        }

        const lastUnsuccessful = promises
          .reverse()
          .find((promise) => promise.status === 'fulfilled' && promise.value.status === false);
        if (lastUnsuccessful && lastUnsuccessful.status === 'fulfilled') {
          this.#logger.debug(`found an unsuccessful txn ${lastUnsuccessful.value.transactionHash}`);
          return Promise.resolve(lastUnsuccessful.value);
        }

        this.#logger.debug(`none of ${previousBroadcastedTxn.length} txn were found`);
        return Promise.reject(previousError);
      },
      (err) =>
        Promise.reject(
          new Error(
            `unable to fetch receipts because: ${err}; failing with last one: ${previousError}`,
          ),
        ),
    );
  }

  private async signAndBroadcast(broadcast: Broadcast): Promise<string> {
    this.#logger.info(`signing transaction: ${JSON.stringify(broadcast.tx)}`);
    const signedTransactionData = await this.#signer(broadcast.tx);

    return this.broadcast(signedTransactionData, broadcast);
  }

  private async getTransactionTemplate(useNonce?: number): Promise<TransactionTemplate> {
    const currentBlock = await this.#connection.eth.getBlockNumber();
    this.#logger.debug(`trying to get a transaction template for block #${currentBlock}`);

    const tx = { ...this.#inputTx };
    const [nonce, gas] = await Promise.all([
      useNonce || this.#connection.eth.getTransactionCount(tx.from),
      this.#feeManager.estimateTx(tx).catch((err) => {
        this.#logger.error(`unable to estimate txn: ${err}`);
        return Promise.reject(err);
      }),
    ]);

    const template = {
      from: tx.from,
      to: tx.to,
      data: tx.data,
      value: tx.value,

      gas,
      nonce,
    };

    return template;
  }

  private rpcCall<T>(method: string, params?: any[]): Promise<T | undefined> {
    // const provider = <AbstractProvider>this.#connection.eth.currentProvider;
    const provider = this.#connection.eth.currentProvider;

    assert(typeof provider === 'object', 'web3 has not currentProvider');
    assert(
      typeof provider?.send === 'function',
      'web3`s currentProvider is not compatible, missing a send() method',
    );

    return new Promise((resolve, reject) => {
      provider.send!(
        {
          method,
          params,
          jsonrpc: '2.0',
          id: new Date().getTime(),
        },
        (err, resp) => {
          if (err) {
            reject(new Error(`rpc call ${method} failed: ${err}`));
          } else if (resp?.error?.message) {
            reject(new Error(`rpc call ${method} returned error: ${resp.error.message}`));
          } else {
            resolve(resp?.result);
          }
        },
      );
    });
  }

  private broadcast(signedTransactionData: string, broadcast: Broadcast): Promise<string> {
    // we use plain RPC call instead of Web3's sendSignedTransaction because the latter takes too much on itself,
    // including unlimited polling. Building a high performance and reliable broadcaster means handling edge cases
    // explicitly
    return new Promise((resolve, reject) => {
      this.#logger.debug(
        `broadcast#${broadcast.attempt}: publishing signed transaction data ${signedTransactionData}`,
      );
      this.rpcCall<string>('eth_sendRawTransaction', [signedTransactionData]).then(
        (txHash) => {
          if (txHash) {
            this.#logger.debug(
              `broadcast#${broadcast.attempt}: publishing succeeded, txHash: ${txHash}`,
            );
            // eslint-disable-next-line no-param-reassign -- intentional because we need to store it
            broadcast.hash = txHash;
            resolve(txHash);
          } else {
            this.#logger.error(`broadcast#${broadcast.attempt}: publishing returned empty result`);
            reject(new Error('publishing returned empty result'));
          }
        },
        (err) => {
          this.#logger.error(`broadcast#${broadcast.attempt}: publishing failed: ${err}`);
          reject(err);
        },
      );
    });
  }
}
