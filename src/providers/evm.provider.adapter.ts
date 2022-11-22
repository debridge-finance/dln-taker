import Web3 from "web3";
import {ProviderAdapter, SendTransactionContext} from "./provider.adapter";
import { clearInterval, clearTimeout } from "timers";
import BigNumber from "bignumber.js";

class Tx {
 data: string;
 to: string;
 value: number ;
}

const broadcast = {
  interval: 2000,
  timeout: 600000,
  k: 1.2,
  gasLimit: new BigNumber(1000000000),
}

export class EvmAdapterProvider implements ProviderAdapter {
  wallet: never;

  constructor(public readonly connection: Web3) { }

  public get address(): string {
    return this.connection.eth.defaultAccount!;
  }


  async sendTransaction(data: unknown, context: SendTransactionContext) {
    const tx = data as Tx;

    const transactionHash = await new Promise(async (resolve, reject) => {
      let gasPrice = await this.connection.eth.getGasPrice();
      const nonce = await this.connection.eth.getTransactionCount (this.connection.eth.defaultAccount!) ;

      let resultTxExecution = await this.sendTxWithNonce(tx, gasPrice, nonce);
      context.logger.debug(`[EVM] Sent tx: ${resultTxExecution}`);


      let interval: NodeJS.Timer;
      let timeout: NodeJS.Timer;
      interval = setInterval(async () => {

        const transactionReceiptResult = await this.connection.eth.getTransactionReceipt(resultTxExecution);
        context.logger.debug(`[EVM] transactionReceiptResult: ${transactionReceiptResult?.status}`);
        if (transactionReceiptResult?.status === true) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve(resultTxExecution);
        } else if (transactionReceiptResult?.status === false) {
          clearInterval(interval);
          clearTimeout(timeout);
          reject('Transaction is failed');
        } else {
          const currentGasPrice = new BigNumber(await this.connection.eth.getGasPrice());
          const previousGasPrice = new BigNumber(gasPrice).multipliedBy(broadcast.k);
          const maxGasPrice = BigNumber.max(currentGasPrice, previousGasPrice);
          if (maxGasPrice.lt(broadcast.gasLimit)) {
            reject('Gas price out of limit');
          }
          gasPrice = maxGasPrice.toFixed(0);
          resultTxExecution = await this.sendTxWithNonce(tx, gasPrice, nonce);
        }
      }, broadcast.interval);
      timeout = setTimeout(() => {
        reject('Transaction is failed');
        clearInterval(interval);
        clearTimeout(timeout);
      }, broadcast.timeout * 1000);
    })
    context.logger.info(`[EVM] Sent final tx: ${transactionHash}`);

    return transactionHash;
  }

  private async sendTxWithNonce(tx: Tx, gasPrice: string, nonce: number) {
    const gasLimit = await this.connection.eth.estimateGas(tx);
    let result = await this.connection.eth.sendTransaction({
      ...tx,
      from: this.connection.eth.defaultAccount!,
      gasPrice,
      gas: gasLimit,
      nonce,
    });
    return result.transactionHash;
  }
}
