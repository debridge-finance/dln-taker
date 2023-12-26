import { ChainId, OrderDataWithId } from '@debridge-finance/dln-client';
import { helpers } from '@debridge-finance/solana-utils';
import { Logger, LoggerOptions } from 'pino';
import Web3 from 'web3';
import { EVM_GAS_LIMIT_MULTIPLIER, InputTransaction } from './signer';
import { ForDefiTransactionBuilderAdapter } from '../authority-forDefi/tx-builder';
import { createBatchOrderUnlockTx } from './tx-generators/createBatchOrderUnlockTx';
import { createOrderFullfillTx } from './tx-generators/createOrderFullfillTx';
import { createERC20ApproveTxs } from './tx-generators/createERC20ApproveTxs';
import { OrderEstimation } from '../chain-common/order-estimator';
import { IExecutor } from '../executor';
import { convertChainIdToChain } from '../authority-forDefi/client-adapter';
import { SupportedChain } from '../config';
import { CreateEvmRawTransactionRequest } from '../authority-forDefi/types/createTransaction';

const enum ForDefiTransactionAction {
  SetAllowance = 'SetAllowance',
}

type TransactionActionPayload<T extends ForDefiTransactionAction> =
  T extends ForDefiTransactionAction.SetAllowance ? { token: string; spender: string } : {};

function encodeNote<T extends ForDefiTransactionAction>(
  action: T,
  payload: TransactionActionPayload<T>,
) {
  return JSON.stringify({
    action,
    payload,
  });
}

export class EvmForDefiTransactionAdapter implements ForDefiTransactionBuilderAdapter {
  readonly #chainId: ChainId;

  readonly #vaultId: string;

  readonly #vaultAddress: Uint8Array;

  readonly #executor: IExecutor;

  readonly #contractsForApprove: string[];

  readonly #connection: Web3;

  constructor(
    chain: ChainId,
    vault: { id: string; address: Uint8Array },
    connection: Web3,
    executor: IExecutor,
    contractsForApprove: string[],
  ) {
    this.#chainId = chain;
    this.#vaultId = vault.id;
    this.#vaultAddress = vault.address;
    this.#executor = executor;
    this.#connection = connection;
    this.#contractsForApprove = contractsForApprove;
  }

  public get address(): string {
    return helpers.bufferToHex(this.#vaultAddress);
  }

  public get bytesAddress(): Uint8Array {
    return this.#vaultAddress;
  }

  async getBatchOrderUnlockTxSender(
    orders: OrderDataWithId[],
    logger: Logger,
  ): Promise<CreateEvmRawTransactionRequest> {
    const craftedTx = await createBatchOrderUnlockTx(this.#executor, orders, logger);
    return this.getCreateTransactionRequest('', craftedTx);
  }

  async getOrderFulfillTxSender(
    orderEstimation: OrderEstimation,
    logger: Logger,
  ): Promise<CreateEvmRawTransactionRequest> {
    const craftedTx = await createOrderFullfillTx(orderEstimation, logger);
    return this.getCreateTransactionRequest('', craftedTx);
  }

  async getInitTxSenders(logger: Logger<LoggerOptions>): Promise<CreateEvmRawTransactionRequest[]> {
    const approvalTxns = await createERC20ApproveTxs(
      this.#chainId,
      this.#contractsForApprove,
      this.#connection,
      this.address,
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

  private async estimateTx(tx: InputTransaction): Promise<number> {
    const gas = await this.#connection.eth.estimateGas({
      to: tx.to,
      data: tx.data,
      value: tx.value,
      from: this.address,
    });
    const gasLimit = Math.round(gas * EVM_GAS_LIMIT_MULTIPLIER);
    return gasLimit;
  }

  private async getCreateTransactionRequest(
    note: string,
    tx: InputTransaction,
  ): Promise<CreateEvmRawTransactionRequest> {
    const gasLimit = await this.estimateTx(tx);

    const request: CreateEvmRawTransactionRequest = {
      vault_id: this.#vaultId,
      note,
      signer_type: 'api_signer',
      type: 'evm_transaction',
      details: {
        type: 'evm_raw_transaction',
        use_secure_node: false,
        chain: convertChainIdToChain(this.#chainId as any as SupportedChain),
        gas: {
          type: 'priority',
          priority_level: 'high',
          gas_limit: (gasLimit * 1.3).toString(),
        },
        to: tx.to,
        value: tx.value?.toString() || '0',
        data: {
          type: 'hex',
          hex_data: tx.data,
        },
        fail_on_prediction_failure: this.#chainId !== ChainId.BSC,
      },
    };

    return request;
  }

  // private async safeGetCustomGasPricing(
  //   tx: InputTransaction,
  //   gasLimit: number,
  // ): Promise<CreateEvmRawTransactionRequest['details']['gas']> {
  //   if (tx.cappedFee && tx.cappedFee > 0)
  //     return this.#feeManager.isLegacy
  //       ? this.safeGetCustomLegacyGas(tx.cappedFee, gasLimit)
  //       : this.safeGetCustomGas(tx.cappedFee, gasLimit);
  //   return {
  //     type: 'priority',
  //     priority_level: 'high',
  //     gas_limit: gasLimit.toString(),
  //   };
  // }
  //
  // private async safeGetCustomLegacyGas(
  //   cappedFee: bigint,
  //   gasLimit: number,
  // ): Promise<CreateEvmRawTransactionRequest['details']['gas']> {
  //   const gasPrice = await this.#feeManager.getOptimisticLegacyFee();
  //   if (cappedFee > 0n) {
  //     const actualFee = BigInt(gasLimit) * gasPrice;
  //     if (cappedFee < actualFee)
  //       throw new Error(
  //         `can't populate pricing: actualFee (${actualFee}) > cappedFee (${cappedFee})`,
  //       );
  //   }

  //   return {
  //     gas_limit: gasLimit.toString(),
  //     type: 'custom',
  //     details: {
  //       type: 'legacy',
  //       price: gasPrice.toString(),
  //     },
  //   };
  // }

  // private async safeGetCustomGas(
  //   cappedFee: bigint,
  //   gasLimit: number,
  // ): Promise<CreateEvmRawTransactionRequest['details']['gas']> {
  //   const fee = await this.#feeManager.getOptimisticFee();
  //   if (cappedFee > 0n) {
  //     const actualFee = BigInt(gasLimit) * fee.maxFeePerGas;
  //     if (cappedFee < actualFee)
  //       throw new Error(
  //         `can't populate pricing: actualFee (${actualFee}) > cappedFee (${cappedFee})`,
  //       );
  //   }

  //   return {
  //     gas_limit: gasLimit.toString(),
  //     type: 'custom',
  //     details: {
  //       type: 'dynamic',
  //       max_fee_per_gas: fee.maxFeePerGas.toString(),
  //       max_priority_fee_per_gas: fee.maxPriorityFeePerGas.toString(),
  //     },
  //   };
  // }
}
