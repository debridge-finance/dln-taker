import { Logger } from 'pino';
import { ExecutorSupportedChain, IExecutor } from '../executor';

export type OrderProcessorContext = {
  logger: Logger;
  config: IExecutor;
  giveChain: ExecutorSupportedChain;
  takeChain: ExecutorSupportedChain;
};
