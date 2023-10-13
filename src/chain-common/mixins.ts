
import { ChainId, tokenAddressToString } from '@debridge-finance/dln-client';

declare global {
  interface Uint8Array {
      toAddress(chain: ChainId): string;
  }
}

Uint8Array.prototype.toAddress = function(chain: ChainId): string {
  return tokenAddressToString(chain, this)
}
