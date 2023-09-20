import { ChainId } from '@debridge-finance/dln-client';
import { Logger } from 'pino';

import { TokensBucket } from '@debridge-finance/legacy-dln-profitability';
import {
  ExecutorInitializingChain,
  ExecutorSupportedChain,
  IExecutor,
} from '../executors/executor';
import { IncomingOrderContext } from '../interfaces';
import { HooksEngine } from '../hooks/HooksEngine';

export type OrderId = string;

export type OrderProcessorContext = {
  logger: Logger;
  config: IExecutor;
  giveChain: ExecutorSupportedChain;
  takeChain: ExecutorSupportedChain;
};

export type OrderProcessorInitContext = {
  takeChain: ExecutorInitializingChain;
  buckets: TokensBucket[];
  logger: Logger;
  hooksEngine: HooksEngine;
  contractsForApprove: string[];
};

export type OrderProcessorInitializer = (
  chainId: ChainId,
  executor: IExecutor,
  context: OrderProcessorInitContext,
) => Promise<IOrderProcessor>;

export interface IOrderProcessor {
  handleEvent(params: IncomingOrderContext): void;
}

/**
 * Represents an order fulfillment engine. Cannot be chained, but can be nested.
 *
 */
export abstract class BaseOrderProcessor implements IOrderProcessor {
  // @ts-ignore Initialized deferredly within the init() method. Should be rewritten during the next major refactoring
  protected chainId: ChainId;

  // @ts-ignore Initialized deferredly within the init() method. Should be rewritten during the next major refactoring
  protected takeChain: ExecutorInitializingChain;

  // @ts-ignore Initialized deferredly within the init() method. Should be rewritten during the next major refactoring
  protected hooksEngine: HooksEngine;

  abstract init(
    chainId: ChainId,
    executor: IExecutor,
    context: OrderProcessorInitContext,
  ): Promise<void>;
  abstract handleEvent(params: IncomingOrderContext): void;
}
