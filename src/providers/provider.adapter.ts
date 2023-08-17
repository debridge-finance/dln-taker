import { Logger } from "pino";

export class SendTransactionContext {
  logger: Logger;
}

export interface ProviderAdapter {
  connection: unknown;
  wallet: unknown;
  address: string;
  bytesAddress: Uint8Array;
  sendTransaction: (
    data: unknown,
    context: SendTransactionContext
  ) => Promise<string>;
}
