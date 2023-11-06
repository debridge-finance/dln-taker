import crypto from 'crypto';
import { Logger } from 'pino';
import {
  CreateEvmRawTransactionRequest,
  CreateSolanaRawTransactionRequest,
  SignedCreateTransactionRequest,
} from './types/createTransaction';

export class ForDefiSigner {
  readonly #signerPrivateKey: crypto.KeyObject;

  readonly #logger: Logger;

  constructor(signerPrivateKey: crypto.KeyObject, logger: Logger) {
    this.#signerPrivateKey = signerPrivateKey;
    this.#logger = logger.child({ service: ForDefiSigner.name });
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
