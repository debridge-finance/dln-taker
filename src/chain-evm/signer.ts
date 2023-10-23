import { ChainId, tokenStringToBuffer } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import Web3 from 'web3';
import { Authority } from '../interfaces';
import { EvmTxBroadcaster } from './networking/broadcaster';
import { EvmChainPreferencesStore } from './preferences/store';

type TransactionConfig = Parameters<Web3['eth']['sendTransaction']>[0];

export type BroadcastedTx = {
  tx: TransactionConfig;
  hash: string;
  time: Date;
};

type EvmTxContext = {
  logger: Logger;
};

export type InputTransaction = {
  data: string;
  to: string;
  value?: string;
  gasLimit?: number;

  // represents a max gas*gasPrice this tx is allowed to increase to during re-broadcasting
  cappedFee?: bigint;
};

export class EvmTxSigner implements Authority {
  readonly chainId: ChainId;

  readonly #address: string;

  readonly #privateKey: string;

  constructor(
    chainId: ChainId,
    private readonly connection: Web3,
    privateKey: string,
  ) {
    this.chainId = chainId;
    const accountEvmFromPrivateKey = this.connection.eth.accounts.privateKeyToAccount(privateKey);
    this.#address = accountEvmFromPrivateKey.address;
    this.#privateKey = accountEvmFromPrivateKey.privateKey;
  }

  static isValidPrivateKey(privateKey: string) {
    // Check length: 64 hex characters
    if (!/^[a-fA-F0-9]{64}$/.test(privateKey)) {
      return false;
    }

    const getBN = (rawPK: string) => {
      try {
        return BigInt(`0x${rawPK}`);
      } catch (e) {
        return 0n;
      }
    };

    const n = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
    const key = getBN(privateKey);

    return key > 0n && key < n;
  }

  public get address(): string {
    return this.#address;
  }

  public get bytesAddress(): Uint8Array {
    return tokenStringToBuffer(this.chainId, this.#address);
  }

  // TODO: must be responsible for queueing txns as they may come from different sources
  async sendTransaction(tx: InputTransaction, context: EvmTxContext): Promise<string> {
    const logger = context.logger.child({
      service: EvmTxSigner.name,
      currentChainId: await this.connection.eth.getChainId(),
    });
    const broadcaster = new EvmTxBroadcaster(
      {
        ...tx,
        from: this.#address,
      },
      tx.cappedFee,
      this.connection,
      EvmChainPreferencesStore.get(this.chainId).feeManager,
      async (txToSign) =>
        (await this.connection.eth.accounts.signTransaction(txToSign, this.#privateKey))
          .rawTransaction || '0x',
      logger,
      EvmChainPreferencesStore.get(this.chainId).broadcasterOpts,
    );

    const receipt = await broadcaster.broadcastAndWait();
    if (receipt.status !== true) throw new Error(`tx ${receipt.transactionHash} reverted`);
    return receipt.transactionHash;
  }
}
