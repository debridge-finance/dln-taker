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

  public get bytesAddress(): Uint8Array {
    return this.wallet.publicKey.toBuffer()
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
        logger: (...args: any) => logger.debug(args), // sendAll will log base64 tx data sent to blockchain
      },
    );

    return txid;
  }
}
