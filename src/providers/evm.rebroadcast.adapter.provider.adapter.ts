import Web3 from "web3";
import {ProviderAdapter, SendTransactionContext} from "./provider.adapter";
import { clearInterval, clearTimeout } from "timers";
import BigNumber from "bignumber.js";
import {EvmRebroadcastAdapterOpts} from "../config";
import {Tx} from "./types/tx";
import {Logger} from "pino";

export class EvmRebroadcastAdapterProviderAdapter implements ProviderAdapter {
  wallet: never;

  private staleTx?: Tx;

  private rebroadcast: EvmRebroadcastAdapterOpts = {};

  constructor(public readonly connection: Web3,  rebroadcast?: EvmRebroadcastAdapterOpts) {
    this.fillDefaultVariables(rebroadcast);
  }

  public get address(): string {
    return this.connection.eth.defaultAccount!;
  }


  async sendTransaction(data: unknown, context: SendTransactionContext) {
    const tx = data as Tx;
    const nonce = await this.connection.eth.getTransactionCount (this.connection.eth.defaultAccount!);
    let nextGasPrice = await this.connection.eth.getGasPrice();

    // {{{ DEBUG
    // For Polygon: you can decrease current gasPrice by 10% to test poller
    nextGasPrice = new BigNumber(nextGasPrice).multipliedBy(0.9).toFixed(0);
    // }}}

    if (this.staleTx && this.staleTx.nonce! >= nonce) {
      nextGasPrice = BigNumber.max(nextGasPrice, new BigNumber(this.staleTx.gasPrice!).multipliedBy(this.rebroadcast.bumpGasPriceMultiplier!)).toFixed(0);
    }

    let currentTx = {
      ...tx,
      nonce,
      gasPrice: nextGasPrice,
    } as Tx;
    let currentTxHash: string;

    const transactionHash = await new Promise(async (resolve, reject) => {
      let rebroadcastInterval: NodeJS.Timer;
      let pollingInterval: NodeJS.Timer;
      let timeout: NodeJS.Timer;

      const clear = () => {
        clearInterval(rebroadcastInterval);
        clearInterval(pollingInterval);
        clearTimeout(timeout);
      };

      const fail = (message: string) => {
        this.staleTx = currentTx;
        clear();
        context.logger.error(`Cannot confirm tx ${currentTxHash}, marking it as stale for future replacement. Reason: ${message}`);
        reject(message);
      };

      try {
        currentTxHash = await this.sendTx(currentTx, context.logger);

        pollingInterval = setInterval(async () => {
          try {
            context.logger.debug(`[EVM ${currentTxHash}] poller`)

            let transactionReceiptResult = await this.connection.eth.getTransactionReceipt(currentTxHash);
            context.logger.debug(`[EVM ${currentTxHash}] poller received tx receipt, status: ${transactionReceiptResult?.status}`);

            if (transactionReceiptResult?.status === true) {
              context.logger.debug(`[EVM ${currentTxHash}] succeeded`);

              this.staleTx = undefined;
              clear();
              resolve(currentTxHash);
            } else if (transactionReceiptResult?.status === false) {
              context.logger.debug(`[EVM ${currentTxHash}] tx reverted`);

              fail(`tx ${currentTxHash} reverted`);
            }
          } catch (e) {
            context.logger.error(`[EVM ${currentTxHash}] poller raised an error: ${e}`);
            context.logger.error(e);
            //todo discuss should we throw here
          }
        }, this.rebroadcast.pollingInterval);

        let attemptsRebroadcast = 0;
        rebroadcastInterval = setInterval(async () => {
          try {
            context.logger.debug(`[EVM ${currentTxHash}] rebroadcasting`);

            if (this.rebroadcast.rebroadcastMaxAttempts === attemptsRebroadcast) {
              context.logger.debug(`[EVM ${currentTxHash}] rebroadcasting aborted, no more attempts (${attemptsRebroadcast}/${this.rebroadcast.rebroadcastMaxAttempts})`);

              fail(`rebroadcasting aborted, no more attempts (${attemptsRebroadcast}/${this.rebroadcast.rebroadcastMaxAttempts}`)
            }

            // pick gas price for bumping
            const currentGasPrice = await this.connection.eth.getGasPrice();
            const bumpedGasPrice = new BigNumber(nextGasPrice).multipliedBy(this.rebroadcast.bumpGasPriceMultiplier!);
            nextGasPrice = BigNumber.max(currentGasPrice, bumpedGasPrice).toFixed(0);
            context.logger.debug(`[EVM ${currentTxHash}] picking bumped gas: current=${currentGasPrice}, bumped=${bumpedGasPrice}, picked=${nextGasPrice}`)

            // check bumped gas price
            currentTx.gasPrice = nextGasPrice;
            if (this.rebroadcast.rebroadcastMaxBumpedGasPriceWei
              && new BigNumber(nextGasPrice).gt(this.rebroadcast.rebroadcastMaxBumpedGasPriceWei)) {
                context.logger.debug(`[EVM ${currentTxHash}] rebroadcasting aborted, picked gas price for bump (${nextGasPrice}) reached max bumped gas price (${this.rebroadcast.rebroadcastMaxBumpedGasPriceWei})`)
                fail(`rebroadcasting aborted, picked gas price for bump (${nextGasPrice}) reached max bumped gas price (${this.rebroadcast.rebroadcastMaxBumpedGasPriceWei})`)
            }

            // run re-broadcast
            attemptsRebroadcast++;
            const rebroadcastedTxHash = await this.sendTx(currentTx, context.logger);
            context.logger.debug(`[EVM ${currentTxHash}] rebroadcasted as ${rebroadcastedTxHash}`);
            currentTxHash = rebroadcastedTxHash;

          } catch (e) {
            context.logger.error(`[EVM ${currentTxHash}] rebroadcast raised an error: ${e}`);
            context.logger.error(e);
            // fail(`rebroadcasting ${currentTxHash} raised an error: ${e}`);
          }
        }, this.rebroadcast.rebroadcastInterval);

        timeout = setTimeout(() => {
            context.logger.error(`[EVM ${currentTxHash}] poller reached timeout of ${this.rebroadcast.pollingTimeframe}ms`);
            fail('poller reached timeout');
        }, this.rebroadcast.pollingTimeframe);

      } catch (e) {
        context.logger.error(`[EVM] sending tx failed`);
        context.logger.error(e);
        fail(`sending tx failed`);
      }
    })

    context.logger.info(`[EVM ${transactionHash}] transaction confirmed`);

    return transactionHash;
  }

  private async sendTx(tx: Tx, logger: Logger): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        const from = this.connection.eth.defaultAccount!;

        const estimatedGas = await this.connection.eth.estimateGas({
          ...tx,
          from
        });
        const gasLimit = (estimatedGas * 1.1).toFixed(0);

        const txForSign = {
          ...tx,
          from,
          gas: gasLimit,
        };

        logger.debug(`[EVM] sending tx: ${JSON.stringify(txForSign)}`);
        this.connection.eth.sendTransaction(txForSign)
          .once('transactionHash', (hash: string) =>{
            logger.debug(`[EVM] tx sent, txHash: ${hash}`);
            resolve(hash);
          }).catch(error => {
            logger.error(error);
            reject(error);
          });
      } catch (error) {
        logger.error(error);
        reject(error);
      }
    });
  }

  private fillDefaultVariables(rebroadcast?: EvmRebroadcastAdapterOpts) {
    if (rebroadcast) {
      this.rebroadcast = Object.assign({}, rebroadcast);
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

}
