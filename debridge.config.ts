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
import * as filters from "./src/filters";

const config: ExecutorLaunchConfig = {
  orderFeed: new WsNextOrder(environment.WSS, {
    headers: {
      Authorization: process.env.WS_API_KEY ? `Bearer ${process.env.WS_API_KEY}` : undefined,
    },
  } as any),

  buckets: [
    //
    // Setting the USDC bucket (all tokens are emitted by Circle Inc on every DLN supported chain)
    //
    new TokensBucket({
      [ChainId.Avalanche]: ["0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"],
      [ChainId.Arbitrum]: ["0xff970a61a04b1ca14834a43f5de4533ebddb5cc8"],
      [ChainId.BSC]: ["0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"],
      [ChainId.Fantom]: ["0x04068da6c83afcfa0e13ba15a6696662335d5b75"],
      [ChainId.Ethereum]: ["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"],
      [ChainId.Polygon]: ["0x2791bca1f2de4661ed88a30c99a7a9449aa84174"],
      [ChainId.Solana]: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
    }),
    // ETH
    new TokensBucket({
      [ChainId.Arbitrum]: ['0x0000000000000000000000000000000000000000'],
      [ChainId.Ethereum]: ['0x0000000000000000000000000000000000000000']
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
      chainRpc: `${process.env.SOLANA_RPC}`,

      // if the order is created on Solana and fulfilled on another chain (e.g. Ethereum),
      // unlocked funds will be sent to this Solana address
      beneficiary: `${process.env.SOLANA_BENEFICIARY}`,

      // if the order is created on another chain (e.g. Ethereum), DLN executor would attempt to fulfill
      // this order on behalf of this address
      // Warn! base58 representation of a private key.
      // Warn! For security reasons, put it to the .env file
      takerPrivateKey: `${process.env.SOLANA_TAKER_PRIVATE_KEY}`,

      // Warn! base58 representation of a private key.
      // Warn! For security reasons, put it to the .env file
      unlockAuthorityPrivateKey: `${process.env.SOLANA_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.Arbitrum,
      chainRpc: `${process.env.ARBITRUM_RPC}`,

      // if the order is created on Ethereum and fulfilled on another chain (e.g. Solana),
      // unlocked funds will be sent to this Ethereum address
      beneficiary: `${process.env.ARBITRUM_BENEFICIARY}`,

      // if the order is created on another chain (e.g. Solana), DLN executor would attempt to fulfill
      // this order on behalf of this address
      // Warn! base64 representation of a private key.
      // Warn! For security reasons, put it to the .env file
      takerPrivateKey: `${process.env.ARBITRUM_TAKER_PRIVATE_KEY}`,

      // if the order is created on another chain (e.g. Solana), DLN executor would unlock it
      // after successful fulfillment on behalf of this address
      // Warn! base64 representation of a private key.
      // Warn! For security reasons, put it to the .env file
      unlockAuthorityPrivateKey: `${process.env.ARBITRUM_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.Avalanche,
      chainRpc: `${process.env.AVALANCHE_RPC}`,

      beneficiary: `${process.env.AVALANCHE_BENEFICIARY}`,
      takerPrivateKey: `${process.env.AVALANCHE_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.AVALANCHE_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.BSC,
      chainRpc: `${process.env.BNB_RPC}`,

      beneficiary: `${process.env.BNB_BENEFICIARY}`,
      takerPrivateKey: `${process.env.BNB_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.BNB_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.Ethereum,
      chainRpc: `${process.env.ETHEREUM_RPC}`,

      beneficiary: `${process.env.ETHEREUM_BENEFICIARY}`,
      takerPrivateKey: `${process.env.ETHEREUM_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.ETHEREUM_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.Polygon,
      chainRpc: `${process.env.POLYGON_RPC}`,

      beneficiary: `${process.env.POLYGON_BENEFICIARY}`,
      takerPrivateKey: `${process.env.POLYGON_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.POLYGON_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },
  ],
};

module.exports = config;
