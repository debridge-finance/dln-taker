import { CachePriceFeed, ChainId, CoingeckoPriceFeed, TokensBucket } from "@debridge-finance/dln-client";
import { ExecutorLaunchConfig } from "./src/config";
import * as processors from "./src/processors";
import { CURRENT_ENVIRONMENT, CURRENT_ENVIRONMENT as environment } from "./src/environments";
import { WsNextOrder } from "./src/orderFeeds/ws.order.feed";

const config: ExecutorLaunchConfig = {
  orderFeed: new WsNextOrder(
    CURRENT_ENVIRONMENT.WSS,
    {
      headers: {
        Authorization: `Bearer ${process.env.WS_API_KEY}`,
      }
    } as any
  ),

  buckets: [
    new TokensBucket({
      [ChainId.Avalanche]: ['0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'],
      [ChainId.Arbitrum]: ['0xff970a61a04b1ca14834a43f5de4533ebddb5cc8'],
      [ChainId.BSC]: ['0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'],
      [ChainId.Fantom]: ['0x04068da6c83afcfa0e13ba15a6696662335d5b75'],
      [ChainId.Ethereum]: ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
      [ChainId.Polygon]: ['0x2791bca1f2de4661ed88a30c99a7a9449aa84174'],
      [ChainId.Solana]: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
    })
  ],

  tokenPriceService: new CachePriceFeed(
    new CoingeckoPriceFeed(process?.env?.COINGECKO_API_KEY),
    60 * 5 // 5min cache
  ),

  orderProcessor: processors.processor(4/*bps*/),

  chains: [
    // {
    //   chain: ChainId.Solana,
    //   chainRpc: `${process.env.RPC_SOLANA}`,

    //   // address
    //   // For security reasons, put it to the .env file
    //   beneficiary: `${process.env.SOLANA_BENEFICIARY}`,

    //   // Warn! base58 representation of a private key.
    //   // Warn! For security reasons, put it to the .env file
    //   takerPrivateKey: `${process.env.SOLANA_TAKER_PRIVATE_KEY}`,

    //   // Warn! base58 representation of a private key.
    //   // Warn! For security reasons, put it to the .env file
    //   unlockAuthorityPrivateKey: `${process.env.SOLANA_TAKER_PRIVATE_KEY}`,
    // },

    {
      chain: ChainId.Arbitrum,
      chainRpc: `${process.env.RPC_ARBITRUM}`,

      beneficiary: `${process.env.ARBITRUM_BENEFICIARY}`,
      takerPrivateKey: `${process.env.ARBITRUM_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.ARBITRUM_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.Avalanche,
      chainRpc: `${process.env.RPC_AVALANCHE}`,

      beneficiary: `${process.env.AVALANCHE_BENEFICIARY}`,
      takerPrivateKey: `${process.env.AVALANCHE_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.AVALANCHE_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.BSC,
      chainRpc: `${process.env.RPC_BNB}`,

      beneficiary: `${process.env.BNB_BENEFICIARY}`,
      takerPrivateKey: `${process.env.BNB_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.BNB_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.Ethereum,
      chainRpc: `${process.env.RPC_ETHEREUM}`,

      beneficiary: `${process.env.ETHEREUM_BENEFICIARY}`,
      takerPrivateKey: `${process.env.ETHEREUM_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.ETHEREUM_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.Polygon,
      chainRpc: `${process.env.RPC_POLYGON}`,

      beneficiary: `${process.env.POLYGON_BENEFICIARY}`,
      takerPrivateKey: `${process.env.POLYGON_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.POLYGON_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },
  ],
};

module.exports = config;
