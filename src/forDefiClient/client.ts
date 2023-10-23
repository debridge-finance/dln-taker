import { Logger } from 'pino';

type Signature = {
  requestBody: string;
  timestamp: string;
  signature: string;
};

type CreateTransactionResponse = {
  id: string;
};

// type ListTransactionsRequest = {
//   vaultId: string;
//   chain: string;
//   initiator: string;
//   states: TxState[];
//   types: string[];

// }

// type TxState =
//   'waiting_for_approval'|
//   'approved'|

//   // finalized state:
//   'signed'|
//   'pushed_to_blockchain'|
//   'queued'|
//   'mined'|
//   'completed'|
//   'aborted'|
//   'error_signing'|
//   'error_pushing_to_blockchain'|
//   'mined_reverted'|
//   'completed_reverted'|
//   'stuck'|
//   'accelerating'|
//   'canceling'|
//   'accelerated'|
//   'cancelled'
// ;

// type ListTransactionsResponse = {
//   total: number;
//   page: number;
//   size: number;
//   transactions: Array<{
//     id: string;
//     note: string;
//     state: TxState;
//   }>;

// }

export class ForDefiClient {
  private readonly apiHost = 'api.fordefi.com';

  readonly #accessToken;

  readonly #logger: Logger;

  constructor(accessToken: string, logger: Logger) {
    this.#accessToken = accessToken;
    this.#logger = logger.child({ service: ForDefiClient.name });
  }

  // async getTransactions(request: ListTransactionsRequest): Promise<ListTransactionsResponse> {}

  async createTransaction(
    tx: Signature,
    idempotenceId?: string,
  ): Promise<CreateTransactionResponse> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.#accessToken}`,
      'X-Timestamp': tx.timestamp,
      'X-Signature': tx.signature,
    };

    if (idempotenceId) headers['X-Idempotence-Id'] = idempotenceId;

    this.#logger.debug(`sending request: ${JSON.stringify(headers)} ${tx.requestBody}`);

    return this.getResponse<CreateTransactionResponse>('/api/v1/transactions', {
      method: 'POST',
      headers,
      body: tx.requestBody,
    });
  }

  private async getResponse<T>(path: string, request: Parameters<typeof fetch>[1]): Promise<T> {
    const { status, parsedData } = await this.readResponse(path, request);
    if (Math.round(status / 100) === 2) {
      this.#logger.trace(parsedData);
      return <T>parsedData;
    }

    this.#logger.error(`fordefi returned code=${status}`);
    this.#logger.error(parsedData);
    throw new Error(`fordefi returned code=${status}`);
  }

  private async readResponse(
    path: string,
    request: Parameters<typeof fetch>[1],
  ): Promise<{ status: number; parsedData: any }> {
    const { status, body } = await this.sendRequest(path, request);

    try {
      const parsedData = JSON.parse(body);
      return {
        status,
        parsedData,
      };
    } catch (e) {
      this.#logger.error(`forDefi returned unrecognizable text: ${body}`);
      throw new Error(`forDefi returned unrecognizable text: ${body}`);
    }
  }

  private async sendRequest(
    path: string,
    request: Parameters<typeof fetch>[1],
  ): Promise<{ status: number; body: string }> {
    try {
      this.#logger.trace(`sending request to ${path}`);
      const response = await fetch(`https://${this.apiHost}${path}`, request);
      return {
        status: response.status,
        body: await response.text(),
      };
    } catch (e) {
      this.#logger.error(`error calling forDefi ${path}: ${e}`);
      this.#logger.error(e);
      throw e;
    }
  }
}
