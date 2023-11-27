import { Logger } from 'pino';
import { assert } from '../errors';
import {
  CreateTransactionResponse,
  SignedCreateTransactionRequest,
} from './types/createTransaction';
import { GetVaultResponse } from './types/getVault';
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

  async getVault(vaultId: string): Promise<GetVaultResponse> {
    const requestPath = `/api/v1/vaults/${vaultId}`;
    return this.getResponse<GetVaultResponse>(requestPath);
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

    const logger = this.#logger.child({
      // use time to track requests across logs!
      requestWatermark: new Date().getTime(),
    });

    const response = await this.sendRequest(path, request, logger);
    const parsedData = await ForDefiClient.readResponse<T>(response, logger);
    if (!response.ok) {
      const error = <ErrorResponse>parsedData;
      logger.debug(
        `response is not Ok: code: ${response}, details: ${error?.title} (${error?.detail}), body: ${parsedData}`,
      );
      throw new Error(
        `forDefi returned unexpected response code: ${response}; ${error?.title} (${error?.detail})`,
      );
    }

    logger.trace(parsedData);
    return parsedData;
  }

  private static async readResponse<T>(
    response: Awaited<ReturnType<typeof fetch>>,
    logger: Logger,
  ): Promise<T> {
    const body = await response.text();
    try {
      return JSON.parse(body);
    } catch (e) {
      logger.error(`forDefi returned unrecognizable text: ${body}`);
      throw new Error(`forDefi returned unrecognizable text: ${body}`);
    }
  }

  private async sendRequest(
    path: string,
    request: Parameters<typeof fetch>[1],
    logger: Logger,
  ): Promise<Awaited<ReturnType<typeof fetch>>> {
    const startedAt = new Date().getTime();

    try {
      {
        // log request safely
        // conceal sensitive keys from the log
        const sanitizedRequestHeaders = {
          ...(request?.headers || {}),
          Authorization: '[concealed]',
        };
        logger.debug(
          `sending request: ${request?.method || 'GET'} ${path} headers: ${JSON.stringify(
            sanitizedRequestHeaders,
          )} ${path}`,
        );
      }

      const response = await fetch(`https://${this.apiHost}${path}`, request);
      return response;
    } catch (e) {
      logger.error(`error calling forDefi ${path}: ${e}`);
      logger.error(e);
      throw e;
    } finally {
      // track request timing
      const elapsedTime = new Date().getTime() - startedAt;
      logger.debug(`request finished in ${elapsedTime / 1000}s`);
    }
  }
}
