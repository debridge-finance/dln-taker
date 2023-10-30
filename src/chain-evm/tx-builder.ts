import { ChainId, OrderDataWithId } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import Web3 from 'web3';
import { OrderEstimation } from '../chain-common/order-estimator';
import { IExecutor } from '../executor';
import { EvmTxSigner } from './signer';
import { createERC20ApproveTxs } from './tx-generators/createERC20ApproveTxs';
import { createBatchOrderUnlockTx } from './tx-generators/createBatchOrderUnlockTx';
import { createOrderFullfillTx } from './tx-generators/createOrderFullfillTx';
import { InitTransactionBuilder } from '../processor';
import { BatchUnlockTransactionBuilder } from '../processors/BatchUnlocker';
import { FulfillTransactionBuilder } from '../chain-common/order-taker';

export class EvmTransactionBuilder
  implements InitTransactionBuilder, FulfillTransactionBuilder, BatchUnlockTransactionBuilder
{
  constructor(
    private readonly chain: ChainId,
    private contractsForApprove: string[],
    private connection: Web3,
    private readonly signer: EvmTxSigner,
    private readonly executor: IExecutor,
  ) {}

  get fulfillAuthority() {
    return {
      address: this.signer.address,
      bytesAddress: this.signer.bytesAddress,
    };
  }

  get unlockAuthority() {
    return {
      address: this.signer.address,
      bytesAddress: this.signer.bytesAddress,
    };
  }

  getOrderFulfillTxSender(orderEstimation: OrderEstimation, logger: Logger) {
    return async () =>
      this.signer.sendTransaction(await createOrderFullfillTx(orderEstimation, logger), { logger });
  }

  getBatchOrderUnlockTxSender(orders: OrderDataWithId[], logger: Logger): () => Promise<string> {
    return async () =>
      this.signer.sendTransaction(await createBatchOrderUnlockTx(this.executor, orders, logger), {
        logger,
      });
  }

  async getInitTxSenders(logger: Logger) {
    const approvalTxns = await createERC20ApproveTxs(
      this.chain,
      this.contractsForApprove,
      this.connection,
      this.signer.address,
      this.executor,
      logger,
    );
    return approvalTxns.map(({ tx, token, spender }) => () => {
      logger.info(
        `Setting ∞ approval on ${token} to be spend by ${spender} on behalf of a ${this.signer.address}`,
      );
      return this.signer.sendTransaction(tx, { logger });
    });
  }
}
