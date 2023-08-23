import {
  CachePriceFeed,
  ChainId,
  CoingeckoPriceFeed,
  MappedPriceFeed,
  PriceTokenService,
  tokenStringToBuffer,
  ZERO_EVM_ADDRESS,
} from '@debridge-finance/dln-client';

type TokenPriceServiceConfiguratorOpts = Partial<{
  coingeckoApiKey: string;
  coingeckoCacheTTL: number;
}>;

const defaultCoingeckoCacheTTL = 60 * 5;

export function tokenPriceService(opts?: TokenPriceServiceConfiguratorOpts): PriceTokenService {
  return new MappedPriceFeed(
    {
      [ChainId.Solana]: {
        // remap USDC@Solana price to USDC@Ethereum
        EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
          type: 'redirect',
          chainId: ChainId.Ethereum,
          token: tokenStringToBuffer(
            ChainId.Ethereum,
            '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          ),
        },
      },
      [ChainId.Linea]: {
        // remap ETH@Linea price to ETH@Ethereum
        [ZERO_EVM_ADDRESS]: {
          type: 'redirect',
          chainId: ChainId.Ethereum,
          token: tokenStringToBuffer(ChainId.Ethereum, ZERO_EVM_ADDRESS),
        },
        // remap USDC@Linea price to USDC@Ethereum
        '0x176211869cA2b568f2A7D4EE941E073a821EE1ff': {
          type: 'redirect',
          chainId: ChainId.Ethereum,
          token: tokenStringToBuffer(
            ChainId.Ethereum,
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          ),
        },
      },
      [ChainId.Base]: {
        // remap ETH@Base price to ETH@Ethereum
        [ZERO_EVM_ADDRESS]: {
          type: 'redirect',
          chainId: ChainId.Ethereum,
          token: tokenStringToBuffer(ChainId.Ethereum, ZERO_EVM_ADDRESS),
        },
        // remap USDbC@Base price to USDC@Ethereum
        '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': {
          type: 'redirect',
          chainId: ChainId.Ethereum,
          token: tokenStringToBuffer(
            ChainId.Ethereum,
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          ),
        },
      },
      [ChainId.Optimism]: {
        // remap ETH@Optimism price to ETH@Ethereum
        [ZERO_EVM_ADDRESS]: {
          type: 'redirect',
          chainId: ChainId.Ethereum,
          token: tokenStringToBuffer(ChainId.Ethereum, ZERO_EVM_ADDRESS),
        },
      },
    },
    new CachePriceFeed(
      new CoingeckoPriceFeed(opts?.coingeckoApiKey),
      opts?.coingeckoCacheTTL || defaultCoingeckoCacheTTL,
    ),
  );
}
