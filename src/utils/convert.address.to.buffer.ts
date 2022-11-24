import {PublicKey} from "@solana/web3.js";
import {ChainId} from "@debridge-finance/dln-client";
import {helpers} from "@debridge-finance/solana-utils";

export const convertAddressToBuffer = (chainId: ChainId, address: string) => {
  if (chainId === ChainId.Solana) {
    return new PublicKey(address).toBytes();
  } else {
    return helpers.hexToBuffer(address);
  }
};
