import { ChainId, tokenStringToBuffer } from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";
import { Logger } from "pino";
import { clearInterval, clearTimeout } from "timers";
import Web3 from "web3";

import { EvmRebroadcastAdapterOpts } from "../config";

import { ProviderAdapter, SendTransactionContext } from "./provider.adapter";
import { approve, isApproved } from "./utils/approve";

// reasonable multiplier for gas estimated before txn is being broadcasted
export const GAS_MULTIPLIER = 1.1;

export type Tx = {
  data: string;
  to: string;
  value: string;

  from?: string;
  gasPrice?: string;
  gas?: number;
  nonce?: number;

  cappedGasPrice?: BigNumber;
}

export class EvmProviderAdapter implements ProviderAdapter {
  private staleTx?: Tx;

  private rebroadcast: EvmRebroadcastAdapterOpts = {};
  public readonly connection: Web3;

  readonly #address: string;
  readonly #privateKey: string;

  constructor(
    private readonly chainId: ChainId,
    rpc: string,
    privateKey: string,
    rebroadcast?: EvmRebroadcastAdapterOpts
  ) {
    this.connection = new Web3(rpc);
    const accountEvmFromPrivateKey =
        this.connection.eth.accounts.privateKeyToAccount(privateKey);
    this.#address = accountEvmFromPrivateKey.address;
    this.#privateKey = accountEvmFromPrivateKey.privateKey;
    this.fillDefaultVariables(rebroadcast);
  }

  public get address(): string {
    return this.#address;
  }

  public get bytesAddress(): Uint8Array {
    return tokenStringToBuffer(this.chainId, this.#address);
  }

  async sendTransaction(data: unknown, context: SendTransactionContext) {
    const logger = context.logger.child({
      service: "EvmProviderAdapter",
      currentChainId: await this.connection.eth.getChainId(),
    });

    const tx = data as Tx;
    if (!tx.to || !tx.data) throw new Error('Unexpected tx')

    const nonce = await this.connection.eth.getTransactionCount(
      this.address
    );
    let nextGasPrice = await this.connection.eth.getGasPrice();

    if (this.staleTx && this.staleTx.nonce! >= nonce) {
      nextGasPrice = BigNumber.max(
        nextGasPrice,
        new BigNumber(this.staleTx.gasPrice!).multipliedBy(
          this.rebroadcast.bumpGasPriceMultiplier!
        )
      ).toFixed(0);
    }

    const currentTx = {
      ...tx,
      nonce,
      gasPrice: nextGasPrice,
    } as Tx;
    let currentTxHash: string;

    const transactionHash: string = await new Promise(async (resolve, reject) => {
      let rebroadcastInterval: NodeJS.Timer;
      let pollingInterval: NodeJS.Timer;
      let timeout: NodeJS.Timer;

      const clearTimers = () => {
        clearInterval(rebroadcastInterval);
        clearInterval(pollingInterval);
        clearTimeout(timeout);
      };

      const success = (txHash: string) => {
        this.staleTx = undefined;
        clearTimers();
        resolve(txHash);
      };

      const failWithUndeterminedBehavior = (message: string) => {
        logger.error(
          `Cannot confirm tx ${currentTxHash}, marking it as stale for future replacement. Reason: ${message}`
        );
        this.staleTx = currentTx;
        clearTimers();
        reject(new Error(message));
      };

      const fail = (message: string) => {
        clearTimers();
        reject(new Error(message));
      };

      try {
        currentTxHash = await this.sendTx(currentTx, logger);
        let pollingLogger = logger.child({
          service: "evm_poller",
          txHash: currentTxHash,
        });

        pollingInterval = setInterval(async () => {
          try {
            pollingLogger.debug(`polling...`);

            const transactionReceiptResult =
              await this.connection.eth.getTransactionReceipt(currentTxHash);
            pollingLogger.debug(
              `poller received tx receipt, status: ${transactionReceiptResult?.status}`
            );

            if (transactionReceiptResult?.status === true) {
              pollingLogger.debug(`tx confirmed`);

              success(currentTxHash);
            } else if (transactionReceiptResult?.status === false) {
              pollingLogger.debug(`tx reverted`);

              fail(`tx ${currentTxHash} reverted`);
            }
          } catch (e) {
            pollingLogger.error(`poller raised an error: ${e}`);
            pollingLogger.error(e);
            // todo discuss should we throw here
          }
        }, this.rebroadcast.pollingInterval);

        let attemptsRebroadcast = 0;
        rebroadcastInterval = setInterval(async () => {
          try {
            pollingLogger.debug(`rebroadcasting...`);

            if (
              this.rebroadcast.rebroadcastMaxAttempts === attemptsRebroadcast
            ) {
              pollingLogger.debug(
                `no more attempts (${attemptsRebroadcast}/${this.rebroadcast.rebroadcastMaxAttempts})`
              );

              failWithUndeterminedBehavior(`rebroadcasting aborted`);
              return;
            }

            // pick gas price for bumping
            const currentGasPrice = await this.connection.eth.getGasPrice();
            const bumpedGasPrice = new BigNumber(nextGasPrice).multipliedBy(
              this.rebroadcast.bumpGasPriceMultiplier!
            );
            nextGasPrice = BigNumber.max(
              currentGasPrice,
              bumpedGasPrice
            ).toFixed(0);
            pollingLogger.debug(
              `picking bumped gas: current=${currentGasPrice}, bumped=${bumpedGasPrice}, picked=${nextGasPrice}`
            );

            // check bumped gas price
            if (
              tx.cappedGasPrice &&
              new BigNumber(nextGasPrice).gt(tx.cappedGasPrice)
            ) {
              pollingLogger.debug(
                `picked gas price for bump (${nextGasPrice}) reached max bumped gas price (${tx.cappedGasPrice})`
              );
              failWithUndeterminedBehavior(`rebroadcasting aborted`);
              return;
            }

            // run re-broadcast
            currentTx.gasPrice = nextGasPrice;
            attemptsRebroadcast++;
            const rebroadcastedTxHash = await this.sendTx(currentTx, logger);
            pollingLogger.debug(`rebroadcasted as ${rebroadcastedTxHash}`);
            pollingLogger = pollingLogger.child({
              txHash: rebroadcastedTxHash
            })
            currentTxHash = rebroadcastedTxHash;
          } catch (e) {
            const message = `rebroadcasting failed: ${e}`;
            pollingLogger.error(message);
            pollingLogger.error(e)
            fail(message);
          }
        }, this.rebroadcast.rebroadcastInterval);

        timeout = setTimeout(() => {
          pollingLogger.error(
            `poller reached timeout of ${this.rebroadcast.pollingTimeframe}ms`
          );
          failWithUndeterminedBehavior("poller reached timeout");
        }, this.rebroadcast.pollingTimeframe);
      } catch (e) {
        const message = `sending tx failed: ${e}`
        logger.error(message);
        logger.error(e);
        fail(message);
      }
    });

    logger.debug(`tx confirmed: ${transactionHash}`);

    return transactionHash;
  }

  private async sendTx(tx: Tx, logger: Logger): Promise<string> {
    return new Promise(async (resolve, reject) => {
      tx.from = this.address;

      if (!tx.gas) {
        let estimatedGas: number = 0;
        try {
          estimatedGas = await this.connection.eth.estimateGas(tx);
        } catch (error) {
          const message = `estimation failed: ${error}`
          logger.error(message);
          logger.error(error);
          logger.error(`tx which caused estimation failure: ${JSON.stringify(tx)}`)
          reject(new Error(message));
          return;
        }
        tx.gas = estimatedGas * GAS_MULTIPLIER;
      }

      tx.gas = Math.round(tx.gas);

      logger.info(`sending tx: ${JSON.stringify(tx)}`);
      const errorHandler = (error: any) => {
        logger.error("sending failed");
        logger.error(error);
        reject(error);
      }

      // kinda weird code below: THREE checks
      try { // this is needed because sendSignedTransaction() may throw an error during tx preparation (e.g., incorrect gas value)
        const signedTx = await this.connection.eth.accounts.signTransaction(tx, this.#privateKey);
        logger.info("Signed tx", signedTx);

        if (!signedTx.rawTransaction) {
          throw new Error(`The raw signed transaction data is empty`);
        }
        this.connection.eth
          .sendSignedTransaction(signedTx.rawTransaction)
          .on("error", errorHandler) // this is needed of RPC node raises an error
          .once("transactionHash", (hash: string) => {
            logger.debug(`tx sent, txHash: ${hash}`);
            resolve(hash);
          })
          .catch(errorHandler); // this is needed to catch async errors occurred in another loop
        }
        catch (error) {
          errorHandler(error)
        }
    });
  }

  private fillDefaultVariables(rebroadcast?: EvmRebroadcastAdapterOpts) {
    if (rebroadcast) {
      this.rebroadcast = { ...rebroadcast };
    }
    if (rebroadcast?.rebroadcastInterval === undefined) {
      this.rebroadcast.rebroadcastInterval = 60_000;
    }

    if (rebroadcast?.rebroadcastMaxAttempts === undefined) {
      this.rebroadcast.rebroadcastMaxAttempts = 3;
    }

    if (rebroadcast?.bumpGasPriceMultiplier === undefined) {
      this.rebroadcast.bumpGasPriceMultiplier = 1.1;
    }

    if (rebroadcast?.pollingTimeframe === undefined) {
      this.rebroadcast.pollingTimeframe = 210_000;
    }

    if (this.rebroadcast.pollingInterval === undefined) {
      this.rebroadcast.pollingInterval = 5_000;
    }
  }

  async approveToken(tokenAddress: string,
              contractAddress: string,
              logger: Logger) {
    if (this.chainId === ChainId.Solana) return Promise.resolve();

    logger.debug(
      `Verifying approval given by ${this.address} to ${contractAddress} to trade on ${tokenAddress} on ${ChainId[this.chainId]}`
    );
    if (tokenAddress === '0x0000000000000000000000000000000000000000') {
      return Promise.resolve();
    }
    const tokenIsApproved = await isApproved(
      this.connection,
      this.address,
      tokenAddress,
      contractAddress
    );
    if (!tokenIsApproved) {
      logger.debug(`Approving ${tokenAddress} on ${ChainId[this.chainId]}`);
      const data = approve(this.connection, tokenAddress, contractAddress);
      await this.sendTransaction(data, { logger });
      logger.debug(
        `Setting approval for ${tokenAddress} on ${ChainId[this.chainId]} succeeded`
      );
    } else {
      logger.debug(`${tokenAddress} already approved on ${ChainId[this.chainId]}`);
    }

    return Promise.resolve();
  }

  estimateGas(tx: Tx): Promise<number> {
    return this.connection.eth.estimateGas({
      ...tx,
      from: this.address,
    });
  }
}
