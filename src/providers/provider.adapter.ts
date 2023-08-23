import { Logger } from 'pino';

export type SendTransactionContext = {
  logger: Logger;
};

export interface ProviderAdapter {
  connection: unknown;
  address: string;
  bytesAddress: Uint8Array;
  sendTransaction: (data: unknown, context: SendTransactionContext) => Promise<string>;
}
