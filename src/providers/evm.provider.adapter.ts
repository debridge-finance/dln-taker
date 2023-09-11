import { ChainId, tokenStringToBuffer } from '@debridge-finance/dln-client';
import BigNumber from 'bignumber.js';
import { Logger } from 'pino';
import { clearInterval } from 'timers';
import Web3 from 'web3';

import {
  avgBlockSpeed,
  BLOCK_CONFIRMATIONS_HARD_CAPS,
  EvmRebroadcastAdapterOpts,
  SupportedChain,
} from '../config';

import { ProviderAdapter, SendTransactionContext } from './provider.adapter';
import { approve, isApproved } from './utils/approve';

type TransactionConfig = Parameters<Web3['eth']['sendTransaction']>[0];
type BroadcastedTx = {
  tx: TransactionConfig;
  hash: string;
  time: Date;
};

// see https://docs.rs/ethers-core/latest/src/ethers_core/types/chain.rs.html#55-166
const eip1559Compatible: { [key in SupportedChain]: boolean } = {
  [ChainId.Arbitrum]: true,
  [ChainId.Avalanche]: true,
  [ChainId.BSC]: false,
  [ChainId.Ethereum]: true,
  [ChainId.Fantom]: false,
  [ChainId.Linea]: true,
  [ChainId.Polygon]: true,
  [ChainId.Solana]: false,
  [ChainId.Base]: true,
  [ChainId.Optimism]: true,
};

export type InputTransaction = {
  data: string;
  to: string;
  value?: string;
  gasLimit?: number;

  // represents a max gas*gasPrice this tx is allowed to increase to during re-broadcasting
  cappedFee?: BigNumber;
};

export class EvmProviderAdapter implements ProviderAdapter {
  private staleTx?: BroadcastedTx;

  private readonly rebroadcast: Required<EvmRebroadcastAdapterOpts>;

  private readonly connection: Web3;

  readonly #address: string;

  readonly #privateKey: string;

  constructor(
    private readonly chainId: ChainId,
    rpc: string,
    privateKey: string,
    rebroadcast?: EvmRebroadcastAdapterOpts,
  ) {
    this.connection = new Web3(rpc);
    const accountEvmFromPrivateKey = this.connection.eth.accounts.privateKeyToAccount(privateKey);
    this.#address = accountEvmFromPrivateKey.address;
    this.#privateKey = accountEvmFromPrivateKey.privateKey;
    this.rebroadcast = this.fillDefaultVariables(rebroadcast);
  }

  public get unsafeGetConnection(): Web3 {
    return this.connection;
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

  get finalizedBlockCount(): number {
    return BLOCK_CONFIRMATIONS_HARD_CAPS[this.chainId as unknown as SupportedChain];
  }

  get isLegacy(): boolean {
    return eip1559Compatible[this.chainId as unknown as SupportedChain] === false;
  }

  /**
   * Priority fee: takes a p75 tip across latest and pending block if any of them is utilized > 50%. Otherwise, takes p50
   * Base fee: takes max base fee across pending and next-to-pending block (in case we are late to be included in the
   * pending block, and we are sure that next-to-pending block is almost ready)
   */
  private async getOptimisticFee(): Promise<{
    baseFee: BigNumber;
    maxFeePerGas: BigNumber;
    maxPriorityFeePerGas: BigNumber;
  }> {
    if (this.isLegacy) {
      throw new Error('Unsupported method');
    }
    const history = await this.connection.eth.getFeeHistory(2, 'pending', [25, 50]);

    // tip is taken depending of two blocks: latest, pending. If any of them is utilized > 50%, put the highest (p75) bid
    const expectedBaseGasGrowth = Math.max(...history.gasUsedRatio) > 0.5;
    const takePercentile = expectedBaseGasGrowth ? 1 : 0;
    const maxPriorityFeePerGas = BigNumber.max(
      ...history.reward.map((r) => BigNumber(r[takePercentile])),
    );

    // however, the base fee must be taken according to pending and next-to-pending block, because that's were we compete
    // for block space
    const baseFee = BigNumber.max(...history.baseFeePerGas.slice(-2));

    return {
      baseFee,
      maxFeePerGas: baseFee.plus(maxPriorityFeePerGas),
      maxPriorityFeePerGas,
    };
  }

  /**
   * Increases optimistic fee if the new txn must overbid (replace) the existing one
   */
  private async getRequiredFee(
    replaceTx?: BroadcastedTx,
  ): Promise<{ baseFee: BigNumber; maxFeePerGas: BigNumber; maxPriorityFeePerGas: BigNumber }> {
    if (this.isLegacy) {
      throw new Error('Unsupported method');
    }

    const fees = await this.getOptimisticFee();

    if (!replaceTx) return fees;

    // if we need to replace a transaction, we must bump both maxPriorityFee and maxFeePerGas
    fees.maxPriorityFeePerGas = BigNumber.max(
      fees.maxPriorityFeePerGas,
      new BigNumber(replaceTx.tx.maxPriorityFeePerGas as string).multipliedBy(
        this.rebroadcast.bumpGasPriceMultiplier!,
      ),
    );

    fees.maxFeePerGas = BigNumber.max(
      fees.baseFee.plus(fees.maxPriorityFeePerGas),
      new BigNumber(replaceTx.tx.maxFeePerGas as string).multipliedBy(
        this.rebroadcast.bumpGasPriceMultiplier!,
      ),
    );

    return fees;
  }

  private async getOptimisticLegacyFee(): Promise<BigNumber> {
    if (!this.isLegacy) {
      throw new Error('Unsupported method');
    }
    return BigNumber(await this.connection.eth.getGasPrice());
  }

  private async getRequiredLegacyFee(replaceTx?: BroadcastedTx): Promise<BigNumber> {
    if (!this.isLegacy) {
      throw new Error('Unsupported method');
    }
    let gasPrice = await this.getOptimisticLegacyFee();

    if (replaceTx) {
      gasPrice = BigNumber.max(
        gasPrice,
        new BigNumber(replaceTx.tx.gasPrice as string).multipliedBy(
          this.rebroadcast.bumpGasPriceMultiplier!,
        ),
      );
    }

    return gasPrice;
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
   * Returns required gasPrice (assuming we want to replace a pending txn, if any)
   */
  async getRequiredGasPrice(): Promise<BigNumber> {
    await this.checkStaleTx();

    if (this.isLegacy) {
      return BigNumber(await this.getRequiredLegacyFee(this.staleTx));
    }

    const fee = await this.getRequiredFee(this.staleTx);
    return fee.maxFeePerGas;
  }

  /**
   * Populates txn with fees, taking capped gas price into consideration
   */
  private async tryPopulateTxPricing(
    inputTx: TransactionConfig,
    replaceTx?: BroadcastedTx,
    cappedFee?: BigNumber,
  ): Promise<TransactionConfig> {
    const tx = await this.populateTransaction(inputTx);

    if (this.isLegacy) {
      const gasPrice = await this.getRequiredLegacyFee(replaceTx);
      if (cappedFee && cappedFee.lt(gasPrice.multipliedBy(tx.gas))) {
        const message = `Unable to populate pricing: transaction fee (gasPrice=${gasPrice}, gasLimit=${
          inputTx.gas
        }, fee=${gasPrice.multipliedBy(tx.gas)}) is greater than cappedFee (${cappedFee})`;
        throw new Error(message);
      }
      tx.gasPrice = gasPrice.toFixed(0);
      return tx;
    }

    const fees = await this.getRequiredFee(replaceTx);
    if (cappedFee && cappedFee.lt(fees.maxFeePerGas.multipliedBy(tx.gas))) {
      const message = `Unable to populate pricing: transaction fee (maxFeePerGas=${
        fees.maxFeePerGas
      }, gasLimit=${inputTx.gas}, fee=${fees.maxFeePerGas.multipliedBy(
        tx.gas,
      )}) is greater than cappedFee (${cappedFee})`;
      throw new Error(message);
    }
    tx.maxFeePerGas = fees.maxFeePerGas.toFixed(0);
    tx.maxPriorityFeePerGas = fees.maxPriorityFeePerGas.toFixed(0);

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

  async sendTransaction(data: unknown, context: SendTransactionContext): Promise<string> {
    const logger = context.logger.child({
      service: 'EvmProviderAdapter',
      currentChainId: await this.connection.eth.getChainId(),
    });

    const tx = data as InputTransaction;
    if (!tx.to || !tx.data) throw new Error('Unexpected tx');

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
    return { ...inputTx, gas: inputTx.gas || (await this.connection.eth.estimateGas(inputTx)) };
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

  async approveToken(tokenAddress: string, contractAddress: string, logger: Logger) {
    if (this.chainId === ChainId.Solana) return Promise.resolve();

    logger.debug(
      `Verifying approval given by ${
        this.address
      } to ${contractAddress} to trade on ${tokenAddress} on ${ChainId[this.chainId]}`,
    );
    if (tokenAddress === '0x0000000000000000000000000000000000000000') {
      return Promise.resolve();
    }
    const tokenIsApproved = await isApproved(
      this.connection,
      this.address,
      tokenAddress,
      contractAddress,
    );
    if (!tokenIsApproved) {
      logger.debug(`Approving ${tokenAddress} on ${ChainId[this.chainId]}`);
      const data = approve(this.connection, tokenAddress, contractAddress);
      await this.sendTransaction(data, { logger });
      logger.debug(`Setting approval for ${tokenAddress} on ${ChainId[this.chainId]} succeeded`);
    } else {
      logger.debug(`${tokenAddress} already approved on ${ChainId[this.chainId]}`);
    }

    return Promise.resolve();
  }

  estimateGas(tx: InputTransaction): Promise<number> {
    return this.connection.eth.estimateGas({
      ...tx,
      from: this.address,
    });
  }
}
