import { ChainId, tokenAddressToString } from '@debridge-finance/dln-client';

declare global {
  interface Uint8Array {
    toAddress(chain: ChainId): string;
  }
}

// eslint-disable-next-line no-extend-native -- Intentional extend of the object
Uint8Array.prototype.toAddress = function (chain: ChainId): string {
  return tokenAddressToString(chain, this);
};
