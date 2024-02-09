import {
  ChainId,
  Logger,
  OneInch,
  SwapConnector,
  SwapConnectorQuoteRequest,
  SwapConnectorQuoteResult,
  SwapConnectorRequest,
  SwapConnectorResult,
} from '@debridge-finance/dln-client';

type OneInchConfig = {
  apiToken?: string;
  apiServer?: string;
  disablePMMProtocols?: boolean;
  disabledProtocols?: string[];
};

export class SwapConnectorImplementationService implements SwapConnector {
  readonly #connectors: { [key in ChainId]: SwapConnector | null };

  constructor(configuration?: { oneInchConfig?: OneInchConfig }) {
    const oneInchV5Connector = new OneInch.OneInchV5Connector({
      customApiURL: configuration?.oneInchConfig?.apiServer || 'https://api.1inch.dev/swap',
      token: configuration?.oneInchConfig?.apiToken,
      disablePMMProtocols: configuration?.oneInchConfig?.disablePMMProtocols,
      disabledProtocols: configuration?.oneInchConfig?.disabledProtocols,
    });

    this.#connectors = {
      [ChainId.Arbitrum]: oneInchV5Connector,
      [ChainId.ArbitrumTest]: null,
      [ChainId.Avalanche]: oneInchV5Connector,
      [ChainId.AvalancheTest]: null,
      [ChainId.Base]: oneInchV5Connector,
      [ChainId.BSC]: oneInchV5Connector,
      [ChainId.BSCTest]: null,
      [ChainId.Ethereum]: oneInchV5Connector,
      [ChainId.Fantom]: oneInchV5Connector,
      [ChainId.Heco]: null,
      [ChainId.HecoTest]: null,
      [ChainId.Kovan]: null,
      [ChainId.Linea]: oneInchV5Connector,
      [ChainId.Neon]: null,
      [ChainId.Optimism]: oneInchV5Connector,
      [ChainId.Polygon]: oneInchV5Connector,
      [ChainId.PolygonTest]: null,
      [ChainId.Solana]: null,
    };
  }

  setConnector(chainId: ChainId, connector: SwapConnector) {
    this.#connectors[chainId] = connector;
  }

  getEstimate(
    request: SwapConnectorQuoteRequest,
    context: { logger: Logger },
  ): Promise<SwapConnectorQuoteResult> {
    return this.#getConnector(request.chainId).getEstimate(request, context);
  }

  getSupportedChains(): ChainId[] {
    return Object.keys(this.#connectors)
      .map((chainId) => chainId as unknown as ChainId)
      .filter((chainId) => this.#connectors[chainId] !== null);
  }

  getSwap(
    request: SwapConnectorRequest,
    context: { logger: Logger },
  ): Promise<SwapConnectorResult> {
    return this.#getConnector(request.chainId).getSwap(request, context);
  }

  setSupportedChains(chains: ChainId[]): void {
    Object.keys(this.#connectors)
      .map((chainId) => chainId as unknown as ChainId)
      .filter((chainId) => !chains.includes(chainId))
      .forEach((chainId) => this.#connectors[chainId] === null);
  }

  #getConnector(chainId: ChainId): SwapConnector {
    const connector = this.#connectors[chainId];
    if (connector === null) {
      throw new Error(`Unsupported chain in swap connector`);
    }

    return connector;
  }
}
