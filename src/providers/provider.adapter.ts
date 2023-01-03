import { Logger } from "pino";

export class SendTransactionContext {
  logger: Logger;
}

export interface ProviderAdapter {
  connection: unknown;
  wallet: unknown;
  address: string;
  sendTransaction: (
    data: unknown,
    context: SendTransactionContext
  ) => Promise<unknown>;
  getBalance: (token: Uint8Array) => Promise<string>;
}
