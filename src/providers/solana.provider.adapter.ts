import { helpers } from "@debridge-finance/solana-utils";
import {
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import { ProviderAdapter, SendTransactionContext } from "./provider.adapter";

export class SolanaProviderAdapter implements ProviderAdapter {
  public wallet: Parameters<typeof helpers.sendAll>["1"];

  constructor(public connection: Connection, wallet: Keypair) {
    this.wallet = new helpers.Wallet(wallet);
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
}
