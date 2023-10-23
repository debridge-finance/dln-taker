import { ChainId, OrderDataWithId } from '@debridge-finance/dln-client';
import { helpers } from '@debridge-finance/solana-utils';
import { Logger, LoggerOptions } from 'pino';
import { OrderEstimation } from 'src/chain-common/order-estimator';
import { IExecutor } from 'src/executor';
import { CreateEvmRawTransactionRequest } from 'src/forDefiClient/create-transaction-requests';
import Web3 from 'web3';
import { EvmFeeManager } from './feeManager';
import { InputTransaction } from './signer';
import { FordefiAdapter } from '../forDefiClient/tx-builder';
import { createBatchOrderUnlockTx } from './tx-generators/createBatchOrderUnlockTx';
import { createOrderFullfillTx } from './tx-generators/createOrderFullfillTx';
import { createERC20ApproveTxs } from './tx-generators/createERC20ApproveTxs';

type EvmRawLegacyTransaction = {
  to: string;
  data: string;
  value?: string;
  gasLimit: number;
  gasPrice: bigint;
};

type EvmRawTransaction = {
  to: string;
  data: string;
  value?: string;
  gasLimit: number;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

const enum ForDefiTransactionAction {
  FulfillOrder = 'FulfillOrder',
  BatchOrderUnlock = 'BatchOrderUnlock',
  SetAllowance = 'SetAllowance',
}

type TransactionActionPayload<T extends ForDefiTransactionAction> =
  {} & (T extends ForDefiTransactionAction.FulfillOrder ? { orderId: string } : {}) &
    (T extends ForDefiTransactionAction.BatchOrderUnlock ? { orderIds: string[] } : {}) &
    (T extends ForDefiTransactionAction.SetAllowance ? { token: string; spender: string } : {});

function encodeNote<T extends ForDefiTransactionAction>(
  action: T,
  payload: TransactionActionPayload<T>,
) {
  return JSON.stringify({
    action,
    payload,
  });
}

export class EvmForDefiTransactionAdapter implements FordefiAdapter {
  readonly #chainId: ChainId;

  readonly #feeManager: EvmFeeManager;

  readonly #vaultId: string;

  readonly #executor: IExecutor;

  readonly #contractsForApprove: string[];

  readonly #connection: Web3;

  constructor(
    chain: ChainId,
    vaultId: string,
    connection: Web3,
    private signerAuthority: string,
    executor: IExecutor,
    contractsForApprove: string[],
  ) {
    this.#chainId = chain;
    this.#vaultId = vaultId;
    this.#executor = executor;
    this.#connection = connection;
    this.#contractsForApprove = contractsForApprove;
    this.#feeManager = new EvmFeeManager(chain, connection);
  }

  async getBatchOrderUnlockTxSender(
    orders: OrderDataWithId[],
    logger: Logger,
  ): Promise<CreateEvmRawTransactionRequest> {
    const craftedTx = await createBatchOrderUnlockTx(this.#executor, orders, logger);
    const note = encodeNote<ForDefiTransactionAction.BatchOrderUnlock>(
      ForDefiTransactionAction.BatchOrderUnlock,
      { orderIds: orders.map((order) => helpers.bufferToHex(order.orderId)) },
    );
    return this.getCreateTransactionRequest(note, craftedTx);
  }

  async getOrderFulfillTxSender(
    orderEstimation: OrderEstimation,
    logger: Logger,
  ): Promise<CreateEvmRawTransactionRequest> {
    const craftedTx = await createOrderFullfillTx(orderEstimation, logger);

    const note = encodeNote<ForDefiTransactionAction.FulfillOrder>(
      ForDefiTransactionAction.FulfillOrder,
      {
        orderId: orderEstimation.order.orderId,
      },
    );
    return this.getCreateTransactionRequest(note, craftedTx);
  }

  async getInitTxSenders(logger: Logger<LoggerOptions>): Promise<CreateEvmRawTransactionRequest[]> {
    const approvalTxns = await createERC20ApproveTxs(
      this.#chainId,
      this.#contractsForApprove,
      this.#connection,
      this.signerAuthority,
      this.#executor,
      logger,
    );
    const txs = [];
    for (const { tx, token, spender } of approvalTxns) {
      const note = encodeNote<ForDefiTransactionAction.SetAllowance>(
        ForDefiTransactionAction.SetAllowance,
        { token, spender },
      );
      // eslint-disable-next-line no-await-in-loop -- Intentional because invoked during the start
      const req = await this.getCreateTransactionRequest(note, tx);
      txs.push(req);
    }

    return txs;
  }

  private async getCreateTransactionRequest(
    note: string,
    craftedTx: InputTransaction,
  ): Promise<CreateEvmRawTransactionRequest> {
    const gasLimit = await this.#connection.eth.estimateGas({
      to: craftedTx.to,
      data: craftedTx.data,
      value: craftedTx.value,
      from: this.signerAuthority,
    });

    const tx = this.#feeManager.isLegacy
      ? await this.populateLegacyTx(craftedTx, gasLimit, craftedTx.cappedFee || 0n)
      : await this.populateTx(craftedTx, gasLimit, craftedTx.cappedFee || 0n);

    return this.convertToRequest(note, tx);
  }

  private convertToRequest(
    note: string,
    tx: EvmRawLegacyTransaction | EvmRawTransaction,
  ): CreateEvmRawTransactionRequest {
    const request: CreateEvmRawTransactionRequest = {
      vault_id: this.#vaultId,
      note,
      signer_type: 'api_signer',
      type: 'evm_transaction',
      details: {
        type: 'evm_raw_transaction',
        use_secure_node: false,
        chain: this.#chainId,
        gas: {
          gas_limit: tx.gasLimit.toString(),
          type: 'custom',
          details:
            'gasPrice' in tx
              ? {
                  type: 'legacy',
                  price: tx.gasPrice.toString(),
                }
              : {
                  type: 'dynamic',
                  max_fee_per_gas: tx.maxFeePerGas.toString(),
                  max_priority_fee_per_gas: tx.maxPriorityFeePerGas.toString(),
                },
        },
        to: tx.to,
        value: tx.value?.toString() || '0',
        data: {
          type: 'hex',
          hex_data: tx.data,
        },
      },
    };

    return request;
  }

  private async populateLegacyTx(
    craftedTx: InputTransaction,
    gasLimit: number,
    cappedFee: bigint,
  ): Promise<EvmRawLegacyTransaction> {
    const tx: EvmRawLegacyTransaction = {
      to: craftedTx.to,
      data: craftedTx.data,
      value: craftedTx.value,
      gasLimit,
      gasPrice: await this.#feeManager.getOptimisticLegacyFee(),
    };

    if (cappedFee > 0n) {
      const actualFee = BigInt(tx.gasLimit) * tx.gasPrice;
      if (cappedFee < actualFee) throw new Error('Out of capped fee');
    }

    return tx;
  }

  private async populateTx(
    craftedTx: InputTransaction,
    gasLimit: number,
    cappedFee: bigint,
  ): Promise<EvmRawTransaction> {
    const fee = await this.#feeManager.getOptimisticFee();
    const tx: EvmRawTransaction = {
      to: craftedTx.to,
      data: craftedTx.data,
      value: craftedTx.value,
      gasLimit,
      maxFeePerGas: fee.maxFeePerGas,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
    };

    if (cappedFee > 0n) {
      const actualFee = BigInt(tx.gasLimit) * tx.maxFeePerGas;
      if (cappedFee < actualFee) throw new Error('Out of capped fee');
    }

    return tx;
  }
}
