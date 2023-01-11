import { ChainId, tokenAddressToString } from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";
import { Logger } from "pino";
import { clearInterval, clearTimeout } from "timers";
import Web3 from "web3";

import { EvmRebroadcastAdapterOpts } from "../config";

import { ProviderAdapter, SendTransactionContext } from "./provider.adapter";
import { Tx } from "./types/tx";
import { getEvmAccountBalance } from "./utils/getEvmAccountBalance";

export class EvmProviderAdapter implements ProviderAdapter {
  wallet: never;

  private staleTx?: Tx;

  private rebroadcast: EvmRebroadcastAdapterOpts = {};

  constructor(
    public readonly connection: Web3,
    rebroadcast?: EvmRebroadcastAdapterOpts
  ) {
    this.fillDefaultVariables(rebroadcast);
  }

  public get address(): string {
    return this.connection.eth.defaultAccount!;
  }

  async sendTransaction(data: unknown, context: SendTransactionContext) {
    const logger = context.logger.child({
      service: "EvmProviderAdapter",
    });

    const tx = data as Tx;
    const nonce = await this.connection.eth.getTransactionCount(
      this.connection.eth.defaultAccount!
    );
    let nextGasPrice = await this.connection.eth.getGasPrice();

    // {{{ DEBUG
    // For Polygon: you can decrease current gasPrice by 10% to test poller
    // nextGasPrice = new BigNumber(nextGasPrice).multipliedBy(0.9).toFixed(0);
    // }}}

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

    const transactionHash = await new Promise(async (resolve, reject) => {
      let rebroadcastInterval: NodeJS.Timer;
      let pollingInterval: NodeJS.Timer;
      let timeout: NodeJS.Timer;

      const clearTimers = () => {
        clearInterval(rebroadcastInterval);
        clearInterval(pollingInterval);
        clearTimeout(timeout);
      };

      const success = (v: any) => {
        this.staleTx = undefined;
        clearTimers();
        resolve(v);
      };

      const failWithUndeterminedBehavior = (message: string) => {
        logger.error(
          `Cannot confirm tx ${currentTxHash}, marking it as stale for future replacement. Reason: ${message}`
        );
        this.staleTx = currentTx;
        clearTimers();
        reject(message);
      };

      const fail = (message: string) => {
        clearTimers();
        reject(message);
      };

      try {
        currentTxHash = await this.sendTx(currentTx, logger);
        const pollingLogger = context.logger.child({ polling: currentTxHash });

        pollingInterval = setInterval(async () => {
          try {
            pollingLogger.debug(`start polling...`);

            const transactionReceiptResult =
              await this.connection.eth.getTransactionReceipt(currentTxHash);
            pollingLogger.debug(
              `poller received tx receipt, status: ${transactionReceiptResult?.status}`
            );

            if (transactionReceiptResult?.status === true) {
              pollingLogger.debug(`succeeded`);

              success(currentTxHash);
            } else if (transactionReceiptResult?.status === false) {
              pollingLogger.debug(`tx reverted`);

              fail(`tx ${currentTxHash} reverted`);
            }
          } catch (e) {
            pollingLogger.error(`poller raised an error: ${e}`);
            // todo discuss should we throw here
          }
        }, this.rebroadcast.pollingInterval);

        let attemptsRebroadcast = 0;
        rebroadcastInterval = setInterval(async () => {
          try {
            pollingLogger.debug(`rebroadcasting`);

            if (
              this.rebroadcast.rebroadcastMaxAttempts === attemptsRebroadcast
            ) {
              pollingLogger.debug(
                `no more attempts (${attemptsRebroadcast}/${this.rebroadcast.rebroadcastMaxAttempts})`
              );

              failWithUndeterminedBehavior(`rebroadcasting aborted`);
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
              this.rebroadcast.rebroadcastMaxBumpedGasPriceWei &&
              new BigNumber(nextGasPrice).gt(
                this.rebroadcast.rebroadcastMaxBumpedGasPriceWei
              )
            ) {
              pollingLogger.debug(
                `picked gas price for bump (${nextGasPrice}) reached max bumped gas price (${this.rebroadcast.rebroadcastMaxBumpedGasPriceWei})`
              );
              failWithUndeterminedBehavior(`rebroadcasting aborted`);
            }

            // run re-broadcast
            currentTx.gasPrice = nextGasPrice;
            attemptsRebroadcast++;
            const rebroadcastedTxHash = await this.sendTx(currentTx, logger);
            pollingLogger.debug(`rebroadcasted as ${rebroadcastedTxHash}`);
            currentTxHash = rebroadcastedTxHash;
          } catch (e) {
            pollingLogger.error(`rebroadcast raised an error: ${e}`);
            // fail(`rebroadcasting ${currentTxHash} raised an error: ${e}`);
          }
        }, this.rebroadcast.rebroadcastInterval);

        timeout = setTimeout(() => {
          pollingLogger.error(
            `poller reached timeout of ${this.rebroadcast.pollingTimeframe}ms`
          );
          failWithUndeterminedBehavior("poller reached timeout");
        }, this.rebroadcast.pollingTimeframe);
      } catch (e) {
        logger.error(`[EVM] sending tx failed: ${e}`, e);
        fail(`sending tx failed`);
      }
    });

    logger.info(`[EVM ${transactionHash}] transaction confirmed`);

    return transactionHash;
  }

  private async sendTx(tx: Tx, logger: Logger): Promise<string> {
    return new Promise(async (resolve, reject) => {
      tx.from = this.connection.eth.defaultAccount!;

      let estimatedGas: number = 0;
      try {
        estimatedGas = await this.connection.eth.estimateGas(tx);
      } catch (error) {
        logger.error(
          `estimation failed: ${error}, tx: ${JSON.stringify(tx)}`,
          error
        );
        reject(error);
      }

      const txForSign = {
        ...tx,
        gas: (estimatedGas * 1.1).toFixed(0),
      };
      logger.debug(`sending tx: ${JSON.stringify(txForSign)}`);
      this.connection.eth
        .sendTransaction(txForSign)
        .once("transactionHash", (hash: string) => {
          logger.debug(`tx sent, txHash: ${hash}`);
          resolve(hash);
        })
        .catch((error) => {
          logger.error("sending failed", error);
          reject(error);
        });
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

    if (rebroadcast?.rebroadcastMaxBumpedGasPriceWei === undefined) {
      this.rebroadcast.rebroadcastMaxBumpedGasPriceWei = undefined;
    }

    if (rebroadcast?.bumpGasPriceMultiplier === undefined) {
      this.rebroadcast.bumpGasPriceMultiplier = 1.15;
    }

    if (rebroadcast?.pollingTimeframe === undefined) {
      this.rebroadcast.pollingTimeframe = 210_000;
    }

    if (this.rebroadcast.pollingInterval === undefined) {
      this.rebroadcast.pollingInterval = 5_000;
    }
  }

  getBalance(token: Uint8Array): Promise<string> {
    return getEvmAccountBalance(
      this.connection,
      tokenAddressToString(ChainId.Ethereum, token), //todo
      this.address
    );
  }
}
