import { OrderDataWithId } from '@debridge-finance/dln-client';
import { helpers } from '@debridge-finance/solana-utils';
import { Logger, LoggerOptions } from 'pino';
import { Connection } from '@solana/web3.js';
import { createBatchOrderUnlockTx } from './tx-generators/createBatchOrderUnlockTx';
import { createOrderFullfillTx } from './tx-generators/createOrderFullfillTx';
import { SolanaForDefiConverter } from './fordefi-converter';
import { OrderEstimation } from '../chain-common/order-estimator';
import { IExecutor } from '../executor';
import { ForDefiTransactionBuilderAdapter } from '../forDefiClient/tx-builder';
import { CreateTransactionRequest } from '../forDefiClient/types/createTransaction';

export class SolanaForDefiTransactionAdapter implements ForDefiTransactionBuilderAdapter {
  readonly #vaultId: string;

  readonly #vaultAddress: Uint8Array;

  readonly #executor: IExecutor;

  readonly #converter: SolanaForDefiConverter;

  constructor(
    vault: { id: string; address: Uint8Array },
    executor: IExecutor,
    connection: Connection,
  ) {
    this.#vaultId = vault.id;
    this.#vaultAddress = vault.address;
    this.#executor = executor;
    this.#converter = new SolanaForDefiConverter(connection);
  }

  public get address(): string {
    return helpers.bufferToHex(this.#vaultAddress);
  }

  public get bytesAddress(): Uint8Array {
    return this.#vaultAddress;
  }

  async getBatchOrderUnlockTxSender(
    orders: OrderDataWithId[],
    logger: Logger<LoggerOptions>,
  ): Promise<CreateTransactionRequest> {
    const versionedTx = await createBatchOrderUnlockTx(this.#executor, orders, logger);
    return this.#converter.convert(versionedTx, '', this.#vaultId);
  }

  async getOrderFulfillTxSender(
    orderEstimation: OrderEstimation,
    logger: Logger<LoggerOptions>,
  ): Promise<CreateTransactionRequest> {
    const versionedTx = await createOrderFullfillTx(orderEstimation, logger);
    return this.#converter.convert(versionedTx, '', this.#vaultId);
  }

  // eslint-disable-next-line class-methods-use-this -- Required by the interface
  getInitTxSenders(): Promise<CreateTransactionRequest[]> {
    throw new Error('Method not supported, use separate PK authority.');
  }
}
