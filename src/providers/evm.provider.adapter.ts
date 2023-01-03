import { ChainId, tokenAddressToString } from "@debridge-finance/dln-client";
import Web3 from "web3";

import { ProviderAdapter, SendTransactionContext } from "./provider.adapter";
import { getBalanceEvm } from "./utils/get.balance.evm";

export class EvmAdapterProvider implements ProviderAdapter {
  wallet: never;

  constructor(public readonly connection: Web3) {}

  public get address(): string {
    return this.connection.eth.defaultAccount!;
  }

  async sendTransaction(data: unknown, context: SendTransactionContext) {
    const tx = data as { data: string; to: string; value: number };
    const gasLimit = await this.connection.eth.estimateGas(tx);
    const gasPrice = await this.connection.eth.getGasPrice();
    const result = await this.connection.eth.sendTransaction({
      ...tx,
      from: this.connection.eth.defaultAccount!,
      gasPrice,
      gas: gasLimit,
    });
    const transactionHash = result.transactionHash;
    context.logger.info(`[EVM] Sent tx: ${transactionHash}`);

    return transactionHash;
  }

  getBalance(token: Uint8Array): Promise<string> {
    return getBalanceEvm(
      this.connection,
      tokenAddressToString(ChainId.Ethereum, token), //todo
      this.address
    );
  }
}
