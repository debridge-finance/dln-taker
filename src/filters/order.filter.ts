import { ChainId, OrderData } from '@debridge-finance/dln-client';
import { Logger } from 'pino';

import { ExecutorSupportedChain, IExecutor } from '../executor';

export interface FilterContext {
  logger: Logger;
  config: IExecutor;
  giveChain: ExecutorSupportedChain;
  takeChain: ExecutorSupportedChain;
}

export type OrderFilterInitContext = {
  logger: Logger;
};

export type OrderFilterInitializer = (
  chainId: ChainId,
  context: OrderFilterInitContext,
) => Promise<OrderFilter>;

/**
 * Represents an order filter routine. Can be chained.
 * Returns true if order can be processed, false otherwise.
 *
 */
export type OrderFilter = (order: OrderData, context: FilterContext) => Promise<boolean>;
