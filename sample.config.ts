import {
  CachePriceFeed,
  ChainId,
  CoingeckoPriceFeed,
  TokensBucket,
} from "@debridge-finance/dln-client";

import { ExecutorLaunchConfig } from "./src/config";
import { CURRENT_ENVIRONMENT as environment } from "./src/environments";
import { WsNextOrder } from "./src/orderFeeds/ws.order.feed";
import * as processors from "./src/processors";

const config: ExecutorLaunchConfig = {
  orderFeed: new WsNextOrder(environment.WSS, {
    headers: {
      Authorization: `Bearer ${process.env.WS_API_KEY}`,
    },
  } as any),

  buckets: [
    new TokensBucket({
      [ChainId.Avalanche]: ["0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"],
      [ChainId.Arbitrum]: ["0xff970a61a04b1ca14834a43f5de4533ebddb5cc8"],
      [ChainId.BSC]: ["0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"],
      [ChainId.Fantom]: ["0x04068da6c83afcfa0e13ba15a6696662335d5b75"],
      [ChainId.Ethereum]: ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"],
      [ChainId.Polygon]: ["0x2791bca1f2de4661ed88a30c99a7a9449aa84174"],
      [ChainId.Solana]: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
    }),
  ],

  tokenPriceService: new CachePriceFeed(
    new CoingeckoPriceFeed(process?.env?.COINGECKO_API_KEY),
    60 * 5 // 5min cache
  ),

  orderProcessor: processors.universalProcessor({
    minProfitabilityBps: 4,
    mempoolInterval: 60 * 5, // 5m
  }),

  chains: [
    {
      chain: ChainId.Solana,
      chainRpc: `${process.env.RPC_SOLANA}`,

      beneficiary: `${process.env.SOLANA_BENEFICIARY}`,
      takerPrivateKey: `${process.env.SOLANA_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.SOLANA_TAKER_PRIVATE_KEY}`,
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
