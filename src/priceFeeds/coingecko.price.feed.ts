import axios from 'axios';
import {
  ChainId,
  ClientError,
  ClientErrorType,
  Logger,
  PriceTokenService,
  tokenAddressToString,
} from '@debridge-finance/dln-client';

export class CoingeckoPriceFeed extends PriceTokenService {
  private readonly domain;

  private readonly endpointTokenPrice = '/api/v3/simple/token_price/';

  private readonly endpointGasPrice = '/api/v3/simple/price';

  private readonly currency = 'usd';

  private readonly api_key: string;


  constructor(private token?: string) {
    super();
    if (token) {
      this.domain = 'https://pro-api.coingecko.com';
      this.api_key = `&x_cg_pro_api_key=${token}`;
    } else {
      this.domain = 'https://api.coingecko.com';
      this.api_key = '';
    }
  }

  async getPrice(chainId: ChainId, token: Uint8Array | null, context?: { logger: Logger }): Promise<number> {
    if (!token) {
      return this.getGasPrice(chainId, context);
    }
    const coinGeckoChainId = this.getCoinGeckoChainId(chainId);
    const tokenAddress = tokenAddressToString(chainId, token);
    if (chainId === ChainId.Solana) {
      if (
        [
          'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
          'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        ].includes(tokenAddress)
      ) {
        return 1; //todo
      }
    }
    const url =
      this.domain +
      this.endpointTokenPrice +
      coinGeckoChainId +
      `?contract_addresses=${tokenAddress}&vs_currencies=${this.currency}`;
    context?.logger?.verbose(`CoinGeckoPriceTokenService url ${url}`);
    const response = await axios.get(url + this.api_key);
    context?.logger?.verbose(
      `CoinGeckoPriceTokenService response ${JSON.stringify(response.data)}`,
    );

    return response.data[tokenAddress][this.currency];
  }

  private async getGasPrice(chainId: ChainId, context?: { logger: Logger }): Promise<number> {
    const getNativeCoinName = this.getNativeCoinName(chainId);
    const url =
      this.domain +
      this.endpointGasPrice +
      `?ids=${getNativeCoinName}&vs_currencies=${this.currency}`;
    context?.logger?.verbose(`CoinGeckoPriceTokenService url ${url}`);
    const response = await axios.get(url + this.api_key);
    context?.logger?.verbose(`CoinGeckoPriceTokenService response ${response.data}`);

    return response.data[getNativeCoinName][this.currency];
  }

  private getNativeCoinName(chainId: ChainId): string | never {
    switch (chainId) {
      case ChainId.Ethereum: {
        return 'ethereum';
      }
      case ChainId.BSC: {
        return 'binancecoin';
      }
      case ChainId.BSCTest: {
        return 'binancecoin';
      }
      case ChainId.Heco: {
        return 'huobi-token';
      }
      case ChainId.HecoTest: {
        return 'huobi-token';
      }
      case ChainId.Polygon: {
        return 'matic-network';
      }
      case ChainId.PolygonTest: {
        return 'matic-network';
      }
      case ChainId.Arbitrum: {
        return 'ethereum';
      }
      case ChainId.Avalanche: {
        return 'avalanche-2';
      }
      case ChainId.AvalancheTest: {
        return 'avalanche-2';
      }
      case ChainId.ArbitrumTest: {
        return 'ethereum';
      }
      case ChainId.Solana: {
        return 'solana';
      }
      case ChainId.Fantom: {
        return 'fantom';
      }
    }
    throw new ClientError(ClientErrorType.UnsupportedChain);
  }

  private getCoinGeckoChainId(chainId: ChainId): string | never {
    switch (chainId) {
      case ChainId.Ethereum: {
        return 'ethereum';
      }
      case ChainId.BSC: {
        return 'binance-smart-chain';
      }
      case ChainId.BSCTest: {
        return 'binance-smart-chain';
      }
      case ChainId.Heco: {
        return 'huobi-token';
      }
      case ChainId.HecoTest: {
        return 'huobi-token';
      }
      case ChainId.Polygon: {
        return 'polygon-pos';
      }
      case ChainId.PolygonTest: {
        return 'polygon-pos';
      }
      case ChainId.Arbitrum: {
        return 'arbitrum-one';
      }
      case ChainId.Avalanche: {
        return 'avalanche';
      }
      case ChainId.AvalancheTest: {
        return 'avalanche';
      }
      case ChainId.ArbitrumTest: {
        return 'arbitrum-one';
      }
      case ChainId.Solana: {
        return 'solana';
      }
      case ChainId.Fantom: {
        return 'fantom';
      }
    }
    throw new ClientError(ClientErrorType.UnsupportedChain);
  }
}
