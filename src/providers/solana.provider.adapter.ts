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
  }

  public get address(): string {
    return helpers.bufferToHex(this.wallet.publicKey.toBuffer());
  }

  async sendTransaction(data: unknown, context: SendTransactionContext) {
    const logger = context.logger.child({
      service: "SolanaProviderAdapter",
      currentChainId: ChainId.Solana,
    });


    const tx = data as Transaction | VersionedTransaction;
    const [txid] = await helpers.sendAll(
      this.connection,
      this.wallet,
      tx,
      {
        rpcCalls: 3,
        skipPreflight: false,
        logger: logger.debug, // sendAll will log base64 tx data sent to blockchain
      },
    );

    // after 30 seconds tx should either be finalized or dropped
    await helpers.sleep(30_000)
    const chainData = await this.connection.getTransaction(txid, {  commitment: "finalized", maxSupportedTransactionVersion: 1 });
    if (chainData === null) throw new Error(`Failed to get transaction ${txid} from chain`);

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
