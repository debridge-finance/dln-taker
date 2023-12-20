import { ChainId } from '@debridge-finance/dln-client';
import { helpers } from '@debridge-finance/solana-utils';
import { Connection, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { Logger } from 'pino';
import { Authority } from '../interfaces';

export type SolanaTxContext = {
  logger: Logger;
  options: Parameters<typeof helpers.sendAll>['3'];
};

export class SolanaTxSigner implements Authority {
  private readonly wallet: helpers.Wallet;

  constructor(
    private readonly connection: Connection,
    wallet: Keypair,
  ) {
    this.wallet = new helpers.Wallet(wallet);
  }

  public get address(): string {
    return helpers.bufferToHex(this.wallet.publicKey.toBuffer());
  }

  public get bytesAddress(): Uint8Array {
    return this.wallet.publicKey.toBuffer();
  }

  async sendTransaction(
    data: VersionedTransaction | Transaction,
    context: SolanaTxContext,
  ): Promise<string> {
    const [tx] = await this.sendTransactions(data, context);
    return tx;
  }

  async sendTransactions(
    data: VersionedTransaction | Transaction | Array<Transaction | VersionedTransaction>,
    context: SolanaTxContext,
  ): Promise<Array<string>> {
    const logger = context.logger.child({
      service: SolanaTxSigner.name,
      currentChainId: ChainId.Solana,
    });

    return helpers.sendAll(this.connection, this.wallet, data, {
      rpcCalls: 3,
      skipPreflight: false,
      logger: (...args: any) => logger.debug(args), // sendAll will log base64 tx data sent to blockchain
      ...context.options,
    });
  }
}
