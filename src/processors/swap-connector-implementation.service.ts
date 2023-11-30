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

export class SwapConnectorImplementationService implements SwapConnector {
  readonly #connectors: { [key in ChainId]: SwapConnector | null };

  constructor(config: { oneInchApi: string }) {
    const oneInchV4Connector = new OneInch.OneInchV4Connector(config.oneInchApi);
    const oneInchV5Connector = new OneInch.OneInchV5Connector(config.oneInchApi);

    this.#connectors = {
      [ChainId.Arbitrum]: oneInchV4Connector,
      [ChainId.ArbitrumTest]: null,
      [ChainId.Avalanche]: oneInchV4Connector,
      [ChainId.AvalancheTest]: null,
      [ChainId.Base]: oneInchV5Connector,
      [ChainId.BSC]: oneInchV4Connector,
      [ChainId.BSCTest]: null,
      [ChainId.Ethereum]: oneInchV4Connector,
      [ChainId.Fantom]: oneInchV4Connector,
      [ChainId.Heco]: null,
      [ChainId.HecoTest]: null,
      [ChainId.Kovan]: null,
      [ChainId.Linea]: oneInchV4Connector,
      [ChainId.Neon]: null,
      [ChainId.Optimism]: oneInchV4Connector,
      [ChainId.Polygon]: oneInchV4Connector,
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
