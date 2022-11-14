export interface ProviderAdapter {
  connection: unknown;
  wallet: unknown;
  address: string;
  sendTransaction: (data: unknown) => Promise<unknown>;
}
