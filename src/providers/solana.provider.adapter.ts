import { ChainId, tokenAddressToString } from "@debridge-finance/dln-client";
import { helpers } from "@debridge-finance/solana-utils";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import { ProviderAdapter, SendTransactionContext } from "./provider.adapter";

export class SolanaProviderAdapter implements ProviderAdapter {
  public wallet: Parameters<typeof helpers.sendAll>["1"];

  constructor(public connection: Connection, wallet: Keypair) {
    this.wallet = new helpers.Wallet(wallet);
    this.getBalance(new Uint8Array());
  }

  public get address(): string {
    return helpers.bufferToHex(this.wallet.publicKey.toBuffer());
  }

  async sendTransaction(data: unknown, context: SendTransactionContext) {
    const txid = await helpers.sendAll(
      this.connection,
      this.wallet,
      [data as Transaction | VersionedTransaction],
      undefined,
      undefined,
      false,
      true
    );
    context.logger.info(`[Solana] Sent tx: ${txid}`);
    return txid;
  }

  async getBalance(token: Uint8Array): Promise<string> {
    const tokenString = tokenAddressToString(ChainId.Solana, token);
    if (tokenString === "11111111111111111111111111111111") {
      return (
        await this.connection.getBalance(this.wallet.publicKey)
      ).toString();
    }
    const response = await this.connection.getParsedTokenAccountsByOwner(
      this.wallet.publicKey,
      { mint: new PublicKey(token) }
    );

    return (
      response.value[0]?.account?.data?.parsed?.info?.tokenAmount?.amount || 0
    );
  }
}
