import { ChainId, tokenStringToBuffer } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { clearInterval } from 'timers';
import Web3 from 'web3';
import { Authority } from '../interfaces';

import { avgBlockSpeed, EvmRebroadcastAdapterOpts, SupportedChain } from '../config';
import { BumpedFeeManager } from './bumpedFeeManager';

type TransactionConfig = Parameters<Web3['eth']['sendTransaction']>[0];

export type BroadcastedTx = {
  tx: TransactionConfig;
  hash: string;
  time: Date;
};

type EvmTxContext = {
  logger: Logger;
};

export type InputTransaction = {
  data: string;
  to: string;
  value?: string;
  gasLimit?: number;

  // represents a max gas*gasPrice this tx is allowed to increase to during re-broadcasting
  cappedFee?: bigint;
};

/**
 * Reasonable multiplier for gas obtained from the estimateGas() RPC call, because sometimes there are cases when
 * tx fails being out of gas (esp on Avalanche).
 * Must be in sync with EVMOrderEstimator.EVM_FULFILL_GAS_PRICE_MULTIPLIER because it directly affects order
 * profitability
 */
export const EVM_GAS_LIMIT_MULTIPLIER = 1.05;

export class EvmTxSigner implements Authority {
  private staleTx?: BroadcastedTx;

  private readonly rebroadcast: Required<EvmRebroadcastAdapterOpts>;

  readonly #address: string;

  readonly #privateKey: string;

  readonly #feeManager: BumpedFeeManager;

  constructor(
    private readonly chainId: ChainId,
    private readonly connection: Web3,
    privateKey: string,
    rebroadcast?: EvmRebroadcastAdapterOpts,
  ) {
    const accountEvmFromPrivateKey = this.connection.eth.accounts.privateKeyToAccount(privateKey);
    this.#address = accountEvmFromPrivateKey.address;
    this.#privateKey = accountEvmFromPrivateKey.privateKey;
    this.rebroadcast = this.fillDefaultVariables(rebroadcast);
    this.#feeManager = new BumpedFeeManager(
      this.rebroadcast.bumpGasPriceMultiplier,
      chainId,
      connection,
    );
  }

  static isValidPrivateKey(privateKey: string) {
    // Check length: 64 hex characters
    if (!/^[a-fA-F0-9]{64}$/.test(privateKey)) {
      return false;
    }

    const getBN = (rawPK: string) => {
      try {
        return BigInt(`0x${rawPK}`);
      } catch (e) {
        return 0n;
      }
    };

    const n = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
    const key = getBN(privateKey);

    return key > 0n && key < n;
  }

  public get address(): string {
    return this.#address;
  }

  public get bytesAddress(): Uint8Array {
    return tokenStringToBuffer(this.chainId, this.#address);
  }

  get avgBlockSpeed(): number {
    return avgBlockSpeed[this.chainId as unknown as SupportedChain];
  }

  private async checkStaleTx(): Promise<void> {
    if (this.staleTx) {
      const nonce = await this.connection.eth.getTransactionCount(this.address);
      if (!this.staleTx.tx.nonce || this.staleTx.tx.nonce <= nonce) {
        this.staleTx = undefined;
      }
    }
  }

  /**
   * Populates txn with fees, taking capped gas price into consideration
   */
  private async tryPopulateTxPricing(
    inputTx: TransactionConfig,
    replaceTx?: BroadcastedTx,
    cappedFee?: bigint,
  ): Promise<TransactionConfig> {
    await this.checkStaleTx();
    const tx = await this.populateTransaction(inputTx);
    const txGas = BigInt(tx.gas.toString());

    if (this.#feeManager.isLegacy) {
      const gasPrice = await this.#feeManager.getRequiredLegacyFee(replaceTx);
      const actualFee = gasPrice * txGas;
      if (cappedFee && cappedFee < actualFee) {
        const message = `Unable to populate pricing: transaction fee (gasPrice=${gasPrice}, gasLimit=${txGas}, fee=${actualFee}) is greater than cappedFee (${cappedFee})`;
        throw new Error(message);
      }
      tx.gasPrice = gasPrice.toString();
      return tx;
    }

    const fees = await this.#feeManager.getRequiredFee(replaceTx);
    const actualFee = fees.maxFeePerGas * txGas;
    if (cappedFee && cappedFee < actualFee) {
      const message = `Unable to populate pricing: transaction fee (maxFeePerGas=${fees.maxFeePerGas}, gasLimit=${inputTx.gas}, fee=${actualFee}) is greater than cappedFee (${cappedFee})`;
      throw new Error(message);
    }
    tx.maxFeePerGas = fees.maxFeePerGas.toString();
    tx.maxPriorityFeePerGas = fees.maxPriorityFeePerGas.toString();

    return tx;
  }

  private async getTransactionTemplate(tx: InputTransaction): Promise<TransactionConfig> {
    const nonce = await this.connection.eth.getTransactionCount(this.address);

    return {
      from: this.address,
      to: tx.to,
      data: tx.data,
      value: tx.value,

      gas: tx.gasLimit,

      nonce,
    };
  }

  async sendTransaction(tx: InputTransaction, context: EvmTxContext): Promise<string> {
    const logger = context.logger.child({
      service: EvmTxSigner.name,
      currentChainId: await this.connection.eth.getChainId(),
    });

    let broadcastedTx: BroadcastedTx;

    // eslint-disable-next-line no-async-promise-executor -- This is a black magic promise, that handles errors gracefully. TODO #862karn81
    const transactionHash: string = await new Promise(async (resolve, reject) => {
      let pollingInterval: NodeJS.Timer;

      const clearTimers = () => {
        clearInterval(pollingInterval);
      };

      const success = () => {
        this.staleTx = undefined;
        clearTimers();
        resolve(broadcastedTx.hash);
      };

      const failWithUndeterminedBehavior = (message: string) => {
        logger.error(
          `Cannot confirm tx ${broadcastedTx.hash}, marking it as stale for future replacement. Reason: ${message}`,
        );
        this.staleTx = broadcastedTx;
        clearTimers();
        reject(new Error(message));
      };

      const fail = (message: string) => {
        clearTimers();
        reject(new Error(message));
      };

      try {
        const template = await this.getTransactionTemplate(tx);
        const txForSending: TransactionConfig = await this.tryPopulateTxPricing(
          template,
          template.nonce === this.staleTx?.tx.nonce ? this.staleTx : undefined,
          tx.cappedFee,
        );

        broadcastedTx = await this.sendTx(txForSending, logger);
        let pollingLogger = logger.child({
          service: 'evm_poller',
          txHash: broadcastedTx.hash,
        });

        let attemptsRebroadcast = 0;
        const initiatedAt = new Date();
        let locked = false;
        pollingInterval = setInterval(async () => {
          if (locked) return;
          locked = true;

          try {
            pollingLogger.debug(`polling...`);

            const transactionReceiptResult = await this.connection.eth.getTransactionReceipt(
              broadcastedTx.hash,
            );
            pollingLogger.debug(
              `poller received tx receipt, status: ${transactionReceiptResult?.status}`,
            );

            if (transactionReceiptResult?.status === true) {
              pollingLogger.debug(`tx confirmed`);

              success();
            } else if (transactionReceiptResult?.status === false) {
              pollingLogger.debug(`tx reverted`);

              fail(`tx ${broadcastedTx.hash} reverted`);
            } else if (
              new Date().getTime() - initiatedAt.getTime() >
              this.rebroadcast.pollingTimeframe
            ) {
              pollingLogger.error(
                `poller reached timeout of ${this.rebroadcast.pollingTimeframe}ms`,
              );
              failWithUndeterminedBehavior('poller reached timeout');
            } else if (
              new Date().getTime() - broadcastedTx.time.getTime() >
              this.rebroadcast.rebroadcastInterval
            ) {
              pollingLogger.debug(`rebroadcasting...`);

              const rebroadcastTemplate = await this.getTransactionTemplate(tx);
              // nonce updated => previously broadcasted txn has been accepted
              if (rebroadcastTemplate.nonce !== broadcastedTx.tx.nonce) {
                pollingLogger.debug(
                  `seems like txn has been confirmed (nonce has been incremented), postponing rebroadcast`,
                );
              } else if (this.rebroadcast.rebroadcastMaxAttempts === attemptsRebroadcast) {
                failWithUndeterminedBehavior(
                  `no more attempts (${attemptsRebroadcast}/${this.rebroadcast.rebroadcastMaxAttempts})`,
                );
              } else {
                // try rebroadcast, bumping price up from previously broadcasted txn
                const txForRebroadcast = await this.tryPopulateTxPricing(
                  rebroadcastTemplate,
                  broadcastedTx,
                  tx.cappedFee,
                );
                attemptsRebroadcast++;
                broadcastedTx = await this.sendTx(txForRebroadcast, logger);
                pollingLogger.debug(`rebroadcasted as ${broadcastedTx.hash}`);
                pollingLogger = pollingLogger.child({
                  txHash: broadcastedTx.hash,
                });
              }
            }
          } catch (e) {
            pollingLogger.error(`poller raised an error: ${e}`);
            pollingLogger.error(e);
            failWithUndeterminedBehavior(`poller raised an error: ${e}`);
          }

          locked = false;
        }, this.rebroadcast.pollingInterval);
      } catch (e) {
        const message = `sending tx failed: ${e}`;
        logger.error(message);
        logger.error(e);
        fail(message);
      }
    });

    logger.debug(`tx confirmed: ${transactionHash}`);

    return transactionHash;
  }

  private async populateTransaction(
    inputTx: TransactionConfig,
  ): Promise<Required<Pick<TransactionConfig, 'gas'>> & Omit<TransactionConfig, 'gas'>> {
    return { ...inputTx, gas: inputTx.gas || (await this.estimateTx(inputTx)) };
  }

  private async estimateTx(tx: TransactionConfig): Promise<number> {
    const gas = await this.connection.eth.estimateGas(tx);
    const gasLimit = Math.round(gas * EVM_GAS_LIMIT_MULTIPLIER);
    return gasLimit;
  }

  private async sendTx(tx: TransactionConfig, logger: Logger): Promise<BroadcastedTx> {
    // eslint-disable-next-line no-async-promise-executor -- This is a black magic promise, that handles errors gracefully. TODO #862karn81
    return new Promise(async (resolve, reject) => {
      logger.debug(`incoming txn: ${JSON.stringify(tx)}`);
      const populatedTx = await this.populateTransaction(tx);

      logger.info(`sending tx: ${JSON.stringify(populatedTx)}`);
      const errorHandler = (error: any) => {
        logger.error('sending failed');
        logger.error(error);
        reject(error);
      };

      // kinda weird code below: THREE checks
      try {
        // this is needed because sendSignedTransaction() may throw an error during tx preparation (e.g., incorrect gas value)
        const signedTx = await this.connection.eth.accounts.signTransaction(
          populatedTx,
          this.#privateKey,
        );
        logger.info(`transaction signed: ${JSON.stringify(signedTx)}`);

        if (!signedTx.rawTransaction) {
          throw new Error(`The raw signed transaction data is empty`);
        }
        this.connection.eth
          .sendSignedTransaction(signedTx.rawTransaction)
          .on('error', errorHandler) // this is needed of RPC node raises an error
          .once('transactionHash', (hash: string) => {
            logger.debug(`tx sent, txHash: ${hash}`);
            resolve({ tx, hash, time: new Date() });
          })
          .catch(errorHandler); // this is needed to catch async errors occurred in another loop
      } catch (error) {
        errorHandler(error);
      }
    });
  }

  private fillDefaultVariables(
    rebroadcast?: EvmRebroadcastAdapterOpts,
  ): Required<EvmRebroadcastAdapterOpts> {
    return {
      rebroadcastInterval: rebroadcast?.rebroadcastInterval || this.avgBlockSpeed * 6 * 1000,
      rebroadcastMaxAttempts: rebroadcast?.rebroadcastMaxAttempts || 3,
      // must be >10% higher because that's go go-ethereum is implemented
      // see https://github.com/ethereum/go-ethereum/blob/d9556533c34f9bb44b7c0212ba55a08a047babef/core/txpool/legacypool/list.go#L286-L309
      bumpGasPriceMultiplier: rebroadcast?.bumpGasPriceMultiplier || 1.11,
      pollingTimeframe: rebroadcast?.pollingTimeframe || this.avgBlockSpeed * 24 * 1000,
      pollingInterval: rebroadcast?.pollingInterval || this.avgBlockSpeed * 1000,
    };
  }
}
