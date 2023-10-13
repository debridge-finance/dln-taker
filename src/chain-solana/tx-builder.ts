import { JupiterWrapper, OrderDataWithId, Solana } from "@debridge-finance/dln-client";
import { Logger } from "pino";
import { OrderEstimation } from "src/chain-common/order-estimator";
import { TransactionBuilder } from "src/chain-common/tx-builder";
import { IExecutor } from "src/executor";
import { SolanaProviderAdapter } from "src/chain-solana/solana.provider.adapter";
import { SolanaOrderFulfillIntent } from "./order.fulfill";
import { unlockTx } from "./unlock.tx";
import { PublicKey } from "@solana/web3.js";

export class SolanaTransactionBuilder implements TransactionBuilder {
    constructor(private solanaClient: Solana.DlnClient,private readonly adapter: SolanaProviderAdapter, private readonly executor: IExecutor, private jupiterConnector: JupiterWrapper) {}

    getOrderFulfillTxSender(orderEstimation: OrderEstimation, logger: Logger) {
      return async () => this.adapter.sendTransaction(
        await new SolanaOrderFulfillIntent(orderEstimation.order, orderEstimation, logger)
          .createOrderFullfillTx(),
        {logger}
      )
    }

    getBatchOrderUnlockTxSender(orders: OrderDataWithId[], logger: Logger): () => Promise<string> {
        return async () => this.adapter.sendTransaction(
          await unlockTx(this.executor, orders, logger),
          {logger}
        )
    }

    async getInitTxSenders(logger: Logger) {
      const txSenders = [];

      logger.debug("initialize solanaClient.destination.debridge...")
      await this.solanaClient.destination.debridge.init()

      // TODO: wait until solana enables getProgramAddress with filters for ALT and init ALT if needed
      logger.debug("Check if Solana Address Lookup Table (ALT) must be pre-initalized")
      const altInitTx = await this.solanaClient.initForFulfillPreswap(
        new PublicKey(this.adapter.bytesAddress),
        Object.values(this.executor.chains).map((chainConfig) => chainConfig.chain),
        this.jupiterConnector,
      );
      if (altInitTx) {
        const func = () => {
          logger.info(`Initializing Solana Address Lookup Table (ALT)`);
          return this.adapter.sendTransaction(altInitTx, { logger });
        }
        txSenders.push(func)
      }

      return txSenders
    }
  }