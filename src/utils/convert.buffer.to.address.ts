import {PublicKey} from "@solana/web3.js";
import {ChainId} from "@debridge-finance/dln-client";
import {helpers} from "@debridge-finance/solana-utils";
import {Buffer} from "buffer";

export const convertBufferToAddress = (chainId: ChainId, address: Uint8Array) => {
  if (chainId === ChainId.Solana) {
    return new PublicKey(address).toBase58();
  } else {
    return helpers.bufferToHex(Buffer.from(address));
  }
};
