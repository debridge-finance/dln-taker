import { ChainId } from '@debridge-finance/dln-client';
import { helpers } from '@debridge-finance/solana-utils';
import { Connection, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { Logger } from 'pino';
import { Authority } from 'src/interfaces';
import { avgBlockSpeed, BLOCK_CONFIRMATIONS_HARD_CAPS } from '../config';

export type SendTransactionContext = {
  logger: Logger;
  options: Parameters<typeof helpers.sendAll>['3'];
};

export class SolanaProviderAdapter implements Authority {
  private readonly wallet: Parameters<typeof helpers.sendAll>['1'];

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

  // eslint-disable-next-line class-methods-use-this -- interface requirement
  get avgBlockSpeed(): number {
    return avgBlockSpeed[ChainId.Solana];
  }

  // eslint-disable-next-line class-methods-use-this -- interface requirement
  get finalizedBlockCount(): number {
    return BLOCK_CONFIRMATIONS_HARD_CAPS[ChainId.Solana];
  }

  async sendTransaction(
    data: VersionedTransaction | Transaction,
    context: SendTransactionContext,
  ): Promise<string> {
    const [tx] = await this.sendTransactions(data, context);
    return tx;
  }

  async sendTransactions(
    data: VersionedTransaction | Transaction | Array<Transaction | VersionedTransaction>,
    context: SendTransactionContext,
  ): Promise<Array<string>> {
    const logger = context.logger.child({
      service: SolanaProviderAdapter.name,
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
