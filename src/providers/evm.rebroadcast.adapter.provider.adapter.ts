import Web3 from "web3";
import {ProviderAdapter, SendTransactionContext} from "./provider.adapter";
import { clearInterval, clearTimeout } from "timers";
import BigNumber from "bignumber.js";
import {EvmRebroadcastAdapterOpts} from "../config";
import {Tx} from "./types/tx";

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
    let gasPrice = await this.connection.eth.getGasPrice();
    gasPrice = '30722810384';//new BigNumber(gasPrice).multipliedBy(0.4).toFixed(0);

    if (this.staleTx && this.staleTx.nonce! >= nonce) {
      gasPrice = BigNumber.max(gasPrice, new BigNumber(this.staleTx.gasPrice!).multipliedBy(this.rebroadcast.bumpGasPriceMultiplier!)).toFixed(0);
    }

    let currentTx = {
      ...tx,
      nonce,
      gasPrice,
    } as Tx;

    const transactionHash = await new Promise(async (resolve, reject) => {

      let resultTxHash = await this.sendTx(currentTx);//todo catch
      context.logger.debug(`[EVM] Sent tx: ${resultTxHash}`);

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
        context.logger.error(`Error: ${message}`);
        reject(message);
      };

      pollingInterval = setInterval(async () => {
        let transactionReceiptResult = await this.connection.eth.getTransactionReceipt(resultTxHash);
        context.logger.debug(`[EVM] polling transactionReceiptResult: ${transactionReceiptResult?.status}`);
        if (transactionReceiptResult?.status === true) {
          this.staleTx = undefined;
          clear();
          resolve(resultTxHash);
        } else if (transactionReceiptResult?.status === false) {
          fail('Transaction is failed');
        }
      }, this.rebroadcast.pollingInterval);

      let attemptsRebroadcast = 0;//todo add to log
      rebroadcastInterval = setInterval(async () => {
        context.logger.debug(`rebroadcasting is started`);
        if (this.rebroadcast.rebroadcastMaxAttempts === attemptsRebroadcast) {
          fail('Attempts is expired')
        }
        const currentGasPrice = await this.connection.eth.getGasPrice();
        gasPrice = BigNumber.max(currentGasPrice, new BigNumber(gasPrice).multipliedBy(this.rebroadcast.bumpGasPriceMultiplier!)).toFixed(0);
        currentTx.gasPrice = gasPrice;
        if (this.rebroadcast.rebroadcastMaxBumpedGasPriceWei
          && new BigNumber(gasPrice).lt(this.rebroadcast.rebroadcastMaxBumpedGasPriceWei)) {
          fail('Gas is higher than rebroadcastMaxBumpedGasPriceWei')
        }
        const currentTxSendingResult = await this.sendTx(currentTx);
        context.logger.debug(`rebroadcasting is finished currentTxSendingResult = ${currentTxSendingResult}`);
        resultTxHash = currentTxSendingResult;

        attemptsRebroadcast++;
      }, this.rebroadcast.rebroadcastInterval);

      timeout = setTimeout(() => {
        fail('Timeout of rebroadcasting');
      }, this.rebroadcast.pollingTimeframe);
    })
    context.logger.info(`[EVM] Sent final tx: ${transactionHash}`);

    return transactionHash;
  }

  private async sendTx(tx: Tx): Promise<string> {
    const gasLimit = await this.connection.eth.estimateGas(tx); //todo

    //todo
    //let result = await
    return new Promise((resolve) => {
      this.connection.eth.sendTransaction({
        ...tx,
        from: this.connection.eth.defaultAccount!,
        gas: gasLimit,
      }).once('transactionHash', (hash: string) =>{
        resolve(hash);
      });
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
      this.rebroadcast.rebroadcastMaxAttempts = 10;//todo 3
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
