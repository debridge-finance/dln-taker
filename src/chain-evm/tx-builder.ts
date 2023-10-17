import { buffersAreEqual, ChainId, OrderDataWithId } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import { OrderEstimation } from 'src/chain-common/order-estimator';
import { TransactionBuilder } from 'src/chain-common/tx-builder';
import { IExecutor } from 'src/executor';
import { EvmTxSigner } from 'src/chain-evm/signer';
import Web3 from 'web3';
import { getApproveTx, getAllowance } from './utils/approve.tx';
import { unlockTx } from './utils/unlock.tx';
import { getFulfillTx } from './utils/orderFulfill.tx';

export class EvmTransactionBuilder implements TransactionBuilder {
  constructor(
    private readonly chain: ChainId,
    private contractsForApprove: string[],
    private connection: Web3,
    private readonly signer: EvmTxSigner,
    private readonly executor: IExecutor,
  ) {}

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
          logger.info(`${token} requires approval`);
          const func = () => {
            logger.debug(
              `Setting approval on ${token} to be spend by ${contract} on behalf of a ${this.signer.address}`,
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
