import { Logger } from 'pino';
import { OrderEstimation } from 'src/chain-common/order-estimator';

export type SendTransactionContext = {
  logger: Logger;
};

export interface ProviderAdapter {
  address: string;
  bytesAddress: Uint8Array;
  avgBlockSpeed: number;
  finalizedBlockCount: number;
  sendTransaction: (data: unknown, context: SendTransactionContext) => Promise<string>;

  // getFulfillIntent(estimation: OrderEstimation): () => Promise<string>;
}
