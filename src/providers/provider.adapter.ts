import {Logger} from "pino";

export type SendTransactionContext = {
  logger: Logger,
};

export interface ProviderAdapter {
  connection: unknown;
  wallet: unknown;
  address: string;
  sendTransaction: (data: unknown, context: SendTransactionContext) => Promise<unknown>;
}
