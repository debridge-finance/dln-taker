import { ChainId, tokenStringToBuffer } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import Web3 from 'web3';
import { Authority } from '../interfaces';

import { avgBlockSpeed, BLOCK_CONFIRMATIONS_HARD_CAPS, SupportedChain } from '../config';
import { TransactionBroadcaster } from './broadcaster/broadcaster';
import { EvmChainPreferencesStore } from './preferences/preferences';

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

  public get address(): string {
    return this.#address;
  }

  public get bytesAddress(): Uint8Array {
    return tokenStringToBuffer(this.chainId, this.#address);
  }

  get avgBlockSpeed(): number {
    return avgBlockSpeed[this.chainId as unknown as SupportedChain];
  }

  get finalizedBlockCount(): number {
    return BLOCK_CONFIRMATIONS_HARD_CAPS[this.chainId as unknown as SupportedChain];
  }

  // TODO: must be responsible for queueing txns as they may come from different sources
  async sendTransaction(tx: InputTransaction, context: EvmTxContext): Promise<string> {
    const logger = context.logger.child({
      service: EvmTxSigner.name,
      currentChainId: await this.connection.eth.getChainId(),
    });
    const broadcaster = new TransactionBroadcaster(
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
