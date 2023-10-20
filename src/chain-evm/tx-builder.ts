import { buffersAreEqual, ChainId, OrderDataWithId } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import Web3 from 'web3';
import { InitTransactionBuilder } from 'src/processor';
import { FulfillTransactionBuilder } from 'src/chain-common/order-taker';
import { BatchUnlockTransactionBuilder } from 'src/processors/BatchUnlocker';
import { OrderEstimation } from '../chain-common/order-estimator';
import { IExecutor } from '../executor';
import { EvmTxSigner } from './signer';
import { getApproveTx, getAllowance } from './utils/approve.tx';
import { unlockTx } from './utils/unlock.tx';
import { getFulfillTx } from './utils/orderFulfill.tx';

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
      this.signer.sendTransaction(await getFulfillTx(orderEstimation, logger), { logger });
  }

  getBatchOrderUnlockTxSender(orders: OrderDataWithId[], logger: Logger): () => Promise<string> {
    return async () =>
      this.signer.sendTransaction(await unlockTx(this.executor, orders, logger), { logger });
  }

  async getInitTxSenders(logger: Logger) {
    logger.debug('Collect ERC-20 tokens that should have approvals');
    const tokens: string[] = [];
    for (const bucket of this.executor.buckets) {
      for (const token of bucket.findTokens(this.chain) || []) {
        if (!buffersAreEqual(token, Buffer.alloc(20, 0))) {
          tokens.push(token.toAddress(this.chain));
        }
      }
    }

    const transactionSenders = [];
    for (const token of tokens) {
      for (const contract of this.contractsForApprove) {
        // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
        const currentAllowance = await getAllowance(
          this.connection,
          token,
          this.signer.address,
          contract,
        );
        if (currentAllowance === 0n) {
          logger.debug(`${token} requires approval`);
          const func = () => {
            logger.info(
              `Setting ∞ approval on ${token} to be spend by ${contract} on behalf of a ${this.signer.address}`,
            );
            return this.signer.sendTransaction(getApproveTx(token, contract), { logger });
          };
          transactionSenders.push(func);
        } else {
          logger.info(
            `Allowance (${currentAllowance}) is set on ${token} to be spend by ${contract} on behalf of a ${this.signer.address}`,
          );
        }
      }
    }

    return transactionSenders;
  }
}
