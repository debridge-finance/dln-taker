import { Logger } from 'pino';
import { assert } from '../errors';
import {
  CreateTransactionResponse,
  SignedCreateTransactionRequest,
} from './types/createTransaction';
import { GetEvmVaultResponse, GetSolanaVaultResponse } from './types/getVault';
import { ListTransactionsRequest, ListTransactionsResponse } from './types/listTransactions';
import { ErrorResponse } from './types/shared';

function convertRequestToQueryParams(data: { [key in string]: any }): URLSearchParams {
  const params = new URLSearchParams();

  Object.keys(data).forEach((key) => {
    if (Array.isArray(data[key])) {
      data[key].forEach((item: any) => {
        assert(typeof item !== 'object', 'nested URLSearchParams not supported');
        params.append(key, item);
      });
    } else {
      params.append(key, data[key]);
    }
  });

  return params;
}

export class ForDefiClient {
  private readonly apiHost = 'api.fordefi.com';

  readonly #accessToken;

  readonly #logger: Logger;

  constructor(accessToken: string, logger: Logger) {
    this.#accessToken = accessToken;
    this.#logger = logger.child({ service: ForDefiClient.name });
  }

  async listTransactions(request: ListTransactionsRequest): Promise<ListTransactionsResponse> {
    const queryParams = convertRequestToQueryParams(request);
    const requestPath = `/api/v1/transactions?${queryParams}`;
    return this.getResponse<ListTransactionsResponse>(requestPath);
  }

  async getVault(vaultId: string): Promise<GetEvmVaultResponse | GetSolanaVaultResponse> {
    const requestPath = `/api/v1/vaults/${vaultId}`;
    return this.getResponse<GetEvmVaultResponse | GetSolanaVaultResponse>(requestPath);
  }

  async createTransaction(
    tx: SignedCreateTransactionRequest,
    idempotenceId?: string,
  ): Promise<CreateTransactionResponse> {
    const headers: HeadersInit = {
      'X-Timestamp': tx.timestamp,
      'X-Signature': tx.signature,
    };

    if (idempotenceId) headers['X-Idempotence-Id'] = idempotenceId;

    return this.getResponse<CreateTransactionResponse>('/api/v1/transactions', {
      method: 'POST',
      headers,
      body: tx.requestBody,
    });
  }

  private async getResponse<T>(
    path: string,
    baseRequest?: Parameters<typeof fetch>[1],
  ): Promise<T> {
    const request = {
      ...(baseRequest || {}),
      headers: {
        ...(baseRequest?.headers || []),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#accessToken}`,
      },
    };

    {
      // log request safely
      // conceal sensitive keys from the log
      const sanitizedRequestHeaders = {
        ...request.headers,
        Authorization: '[concealed]',
      };
      this.#logger.debug(`sending request: ${JSON.stringify(sanitizedRequestHeaders)} ${path}`);
    }

    const { status, parsedData } = await this.readResponse(path, request);
    if (Math.round(status / 100) === 2) {
      this.#logger.trace(parsedData);
      return <T>parsedData;
    }

    const error = <ErrorResponse>parsedData;
    this.#logger.error(
      `fordefi returned code=${status}: ${error.title} | ${error.detail} | ${error.request_id}`,
    );
    this.#logger.error(parsedData);
    throw new Error(`fordefi returned code=${status}; ${error.title} (${error.detail})`);
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
      this.#logger.debug(`forDefi: requesting ${path}`);
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
