import { Jupiter, SwapConnectorQuoteRequest, buffersAreEqual } from '@debridge-finance/dln-client';

export class JupiterDexExcluder extends Jupiter.JupiterRouteLimiter {
  constructor(private nativeWhitelist: string[]) {
    super();
  }

  getExcludedDexes(swapInfo: SwapConnectorQuoteRequest): Promise<string[]> {
    const native = Buffer.alloc(32);
    if (buffersAreEqual(swapInfo.fromTokenAddress, native)) {
      if (this.nativeWhitelist && this.nativeWhitelist.length > 0) {
        return Promise.resolve(this.whitelist(this.nativeWhitelist));
      }
    }

    return Promise.resolve([]);
  }
}
