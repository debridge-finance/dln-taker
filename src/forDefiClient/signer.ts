import crypto from 'crypto';
import { Authority } from 'src/interfaces';
import {
  CreateEvmRawTransactionRequest,
  CreateSolanaRawTransactionRequest,
} from 'src/forDefiClient/create-transaction-requests';
import { helpers } from '@debridge-finance/solana-utils';
import { Logger } from 'pino';

type SignedCreateTransactionRequest = {
  requestBody: string;
  timestamp: string;
  signature: string;
};

export class ForDefiSigner implements Authority {
  readonly #address: Uint8Array;

  readonly #signerPrivateKey: crypto.KeyObject;

  readonly #logger: Logger;

  constructor(bytesAddress: Uint8Array, signerPrivateKey: crypto.KeyObject, logger: Logger) {
    this.#address = bytesAddress;
    this.#signerPrivateKey = signerPrivateKey;
    this.#logger = logger.child({ service: ForDefiSigner.name });
  }

  public get address(): string {
    return helpers.bufferToHex(this.#address);
  }

  public get bytesAddress(): Uint8Array {
    return this.#address;
  }

  sign(
    request: CreateEvmRawTransactionRequest | CreateSolanaRawTransactionRequest,
  ): SignedCreateTransactionRequest {
    const requestBody = JSON.stringify(request);
    this.#logger.debug(`signing transaction: ${requestBody}`);

    const path = '/api/v1/transactions';
    const timestamp = new Date().getTime().toString();
    const payload = `${path}|${timestamp}|${requestBody}`;

    const sign = crypto.createSign('SHA256').update(payload, 'utf8').end();
    const signature = sign.sign(this.#signerPrivateKey, 'base64');

    return {
      requestBody,
      timestamp,
      signature,
    };
  }
}
