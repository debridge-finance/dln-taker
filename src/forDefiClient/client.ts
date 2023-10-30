import { Logger } from 'pino';
import { SupportedChain } from 'src/config';
import { assert } from 'src/errors';

type Signature = {
  requestBody: string;
  timestamp: string;
  signature: string;
};

type CreateTransactionResponse = {
  id: string;
};

type ListTransactionsRequest = {
  page?: number;
  size?: number;
  created_before?: string;
  created_after?: string;
  modified_after?: string;
  vault_ids?: string[];
  chains?: ChainName[];
  initiator_ids?: string[];
  states?: Array<'pending' | 'finalized' | 'approved'>;
  types?: Array<'evm_transaction' | 'solana_transaction'>;
  sub_types?: Array<string>;
  signer_types?: Array<'initiator' | 'api_signer' | 'end_user'>;
  transaction_ids?: Array<string>;
  end_user_ids?: Array<string>;
  is_hidden?: boolean;
  sort_by?:
    | 'created_at_asc'
    | 'created_at_desc'
    | 'modified_at_asc'
    | 'modified_at_desc'
    | 'type_asc'
    | 'type_desc'
    | 'chains_asc'
    | 'chains_desc'
    | 'initiators_asc'
    | 'initiators_desc'
    | 'state_asc'
    | 'state_desc';
};

type TxState =
  | 'waiting_for_approval'
  | 'approved'

  // finalized state:
  | 'signed'
  | 'pushed_to_blockchain'
  | 'queued'
  | 'mined'
  | 'completed'
  | 'aborted'
  | 'error_signing'
  | 'error_pushing_to_blockchain'
  | 'mined_reverted'
  | 'completed_reverted'
  | 'stuck'
  | 'accelerating'
  | 'canceling'
  | 'accelerated'
  | 'cancelled';

type ChainName =
  | 'evm_1'
  | 'evm_5'
  | 'evm_10'
  | 'evm_56'
  | 'evm_100'
  | 'evm_137'
  | 'evm_250'
  | 'evm_324'
  | 'evm_1101'
  | 'evm_2222'
  | 'evm_7700'
  | 'evm_8453'
  | 'evm_80001'
  | 'evm_42161'
  | 'evm_43114'
  | 'evm_59144'
  | 'evm_11155111'
  | 'evm_ethereum_mainnet'
  | 'evm_ethereum_goerli'
  | 'evm_optimism_mainnet'
  | 'evm_bsc_mainnet'
  | 'evm_gnosis_mainnet'
  | 'evm_polygon_mainnet'
  | 'evm_fantom_mainnet'
  | 'evm_arbitrum_mainnet'
  | 'evm_avalanche_chain'
  | 'evm_kava_mainnet'
  | 'evm_polygon_mumbai'
  | 'evm_ethereum_sepolia'
  | 'evm_polygon_zkevm_mainnet'
  | 'evm_zksync_era_mainnet'
  | 'evm_base_mainnet'
  | 'evm_linea_mainnet'
  | 'evm_canto_mainnet'
  | 'solana_mainnet'
  | 'solana_devnet'
  | 'cosmos_cosmoshub-4'
  | 'cosmos_osmosis-1'
  | 'cosmos_dydx-testnet-3'
  | 'cosmos_dydx-testnet-4';

type EvmTransaction = {
  id: string;
  note: string;
  state: TxState;
};

type SolanaTransaction = {
  id: string;
  note: string;
  state: TxState;
};

type ListTransactionsResponse = {
  total: number;
  page: number;
  size: number;
  transactions: Array<EvmTransaction | SolanaTransaction>;
};

export function convertChainIdToChain(chainId: SupportedChain): ChainName {
  switch (chainId) {
    case SupportedChain.Arbitrum:
      return 'evm_arbitrum_mainnet';
    case SupportedChain.Avalanche:
      return 'evm_avalanche_chain';
    case SupportedChain.BSC:
      return 'evm_bsc_mainnet';
    case SupportedChain.Ethereum:
      return 'evm_ethereum_mainnet';
    case SupportedChain.Fantom:
      return 'evm_fantom_mainnet';
    case SupportedChain.Linea:
      return 'evm_linea_mainnet';
    case SupportedChain.Polygon:
      return 'evm_polygon_mainnet';
    case SupportedChain.Solana:
      return 'solana_mainnet';
    case SupportedChain.Base:
      return 'evm_base_mainnet';
    case SupportedChain.Optimism:
      return 'evm_optimism_mainnet';
    default:
      throw new Error(`Unsupported engine: ${chainId}`);
  }
}

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
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.#accessToken}`,
    };

    const queryParams = convertRequestToQueryParams(request);
    const requestPath = `/api/v1/transactions?${queryParams}`;

    return this.getResponse<ListTransactionsResponse>(requestPath, {
      method: 'GET',
      headers,
    });
  }

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

    return this.getResponse<CreateTransactionResponse>('/api/v1/transactions', {
      method: 'POST',
      headers,
      body: tx.requestBody,
    });
  }

  private async getResponse<T>(path: string, request: Parameters<typeof fetch>[1]): Promise<T> {
    const sanitizedRequestHeaders = {
      ...(request?.headers || []),
      Authorization: undefined,
    };
    this.#logger.debug(`sending request: ${JSON.stringify(sanitizedRequestHeaders)} ${path}`);

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
