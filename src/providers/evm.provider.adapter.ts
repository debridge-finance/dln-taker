import Web3 from "web3";
import {ProviderAdapter, SendTransactionContext} from "./provider.adapter";

export class EvmAdapterProvider implements ProviderAdapter {
  wallet: never;

  constructor(public readonly connection: Web3) { }

  public get address(): string {
    return this.connection.eth.defaultAccount!;
  }

  async sendTransaction(data: unknown, context: SendTransactionContext) {
    const tx = data as { data: string; to: string; value: number };
    const gasLimit = await this.connection.eth.estimateGas(tx);
    let gasPrice = await this.connection.eth.getGasPrice();
    const transactionHash = await new Promise((resolve, reject) => {
      this.connection.eth.sendTransaction({
        ...tx,
        from: this.connection.eth.defaultAccount!,
        gasPrice,
        gas: gasLimit,
      })
        .once('transactionHash', (hash: string) =>{
          context.logger.debug(`[EVM] tx sent, txHash: ${hash}`);
          resolve(hash);
        }).catch(error => {
        context.logger.error(error);
        reject(error);
      });
    });

    context.logger.info(`[EVM] Sent tx: ${transactionHash}`);

    return transactionHash;
  }
}
