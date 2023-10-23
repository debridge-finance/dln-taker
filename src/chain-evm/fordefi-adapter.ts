import { ChainId, OrderDataWithId } from '@debridge-finance/dln-client';
import { helpers } from '@debridge-finance/solana-utils';
import { Logger, LoggerOptions } from 'pino';
import Web3 from 'web3';
import { InputTransaction } from './signer';
import { ForDefiTransactionBuilderAdapter } from '../authority-forDefi/tx-builder';
import { createBatchOrderUnlockTx } from './tx-generators/createBatchOrderUnlockTx';
import { createOrderFullfillTx } from './tx-generators/createOrderFullfillTx';
import { createERC20ApproveTxs } from './tx-generators/createERC20ApproveTxs';
import { OrderEstimation } from '../chain-common/order-estimator';
import { IExecutor } from '../executor';
import { convertChainIdToChain as getForDefiChainNameByChainId } from '../authority-forDefi/client-adapter';
import { CreateEvmRawTransactionRequest } from '../authority-forDefi/types/createTransaction';
import { getBoolean } from '../env-utils';
import { EvmChainPreferencesStore } from './preferences/store';

// Indicates if we should disable prediction on the ForDefi side (sometimes it fails)
function isForciblyDisablePredictionFailure(chainId: ChainId): boolean {
  return getBoolean(
    `FORDEFI_DISABLE_PREDICTION_FAILURE_FOR_${ChainId[chainId].toUpperCase()}`,
    false,
  );
}

// see CreateEvmRawTransactionRequest
const defaultNonHighGasPriority: 'medium' | 'low' = 'medium';
// Indicates if the "high" gas priority could not be used as a default
function isDisallowHighGasPriority(chainId: ChainId): boolean {
  return getBoolean(
    `FORDEFI_DISALLOW_HIGH_GAS_PRIORITY_FOR_${ChainId[chainId].toUpperCase()}`,
    false,
  );
}

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
    return this.getCreateTransactionRequest('', craftedTx, logger);
  }

  async getOrderFulfillTxSender(
    orderEstimation: OrderEstimation,
    logger: Logger,
  ): Promise<CreateEvmRawTransactionRequest> {
    const craftedTx = await createOrderFullfillTx(orderEstimation, logger);
    return this.getCreateTransactionRequest('', craftedTx, logger);
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
      const req = await this.getCreateTransactionRequest(note, tx, logger);
      txs.push(req);
    }

    return txs;
  }

  private async getCreateTransactionRequest(
    note: string,
    tx: InputTransaction,
    logger: Logger,
  ): Promise<CreateEvmRawTransactionRequest> {
    const gasLimit = await EvmChainPreferencesStore.get(this.#chainId).feeManager.estimateTx(
      {
        ...tx,
        from: this.#vaultAddress.toAddress(this.#chainId),
      },
      { logger },
    );

    const request: CreateEvmRawTransactionRequest = {
      vault_id: this.#vaultId,
      note,
      signer_type: 'api_signer',
      type: 'evm_transaction',
      details: {
        type: 'evm_raw_transaction',
        use_secure_node: false,
        chain: getForDefiChainNameByChainId(this.#chainId),
        gas: {
          type: 'priority',
          priority_level: isDisallowHighGasPriority(this.#chainId)
            ? defaultNonHighGasPriority
            : 'high',
          gas_limit: gasLimit.toString(),
        },
        to: tx.to,
        value: tx.value?.toString() || '0',
        data: {
          type: 'hex',
          hex_data: tx.data,
        },
        fail_on_prediction_failure: !isForciblyDisablePredictionFailure(this.#chainId),
      },
    };

    return request;
  }
}
