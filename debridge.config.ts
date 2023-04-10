import {
  CachePriceFeed,
  ChainId,
  CoingeckoPriceFeed,
  TokensBucket,
} from "@debridge-finance/dln-client";

import { ExecutorLaunchConfig } from "./src/config";
import * as environments from "./src/environments";
import { WsNextOrder } from "./src/orderFeeds/ws.order.feed";
import * as processors from "./src/processors";
import { Hooks } from "./src/hooks/HookEnums";
import {TelegramNotifier} from "./src/hooks/notification/TelegramNotifier";
import {orderFeedConnected} from "./src/hooks/handlers/OrderFeedConnectedHookHandler";
import {orderFeedDisconnected} from "./src/hooks/handlers/OrderFeedDisconnectedHookHandler";
import {orderPostponed} from "./src/hooks/handlers/OrderPostponedHookHandler";
import {orderRejected} from "./src/hooks/handlers/OrderRejectedHookHandler";

const environment = !!process.env.USE_MADRID ? environments.PRERELEASE_ENVIRONMENT_CODENAME_MADRID : environments.PRODUCTION;
const telegramNotifier = new TelegramNotifier(process.env.TG_KEY!, [process.env.TG_CHAT_ID!]);

const config: ExecutorLaunchConfig = {
  orderFeed: new WsNextOrder(process.env.WSS ?? environment.WSS, {
    headers: {
      Authorization: process.env.WS_API_KEY ? `Bearer ${process.env.WS_API_KEY}` : undefined,
    },
  } as any),

  hookHandlers: {
    [Hooks.OrderFeedConnected]: [orderFeedConnected(telegramNotifier)],
    [Hooks.OrderFeedDisconnected]: [orderFeedDisconnected(telegramNotifier)],
    [Hooks.OrderPostponed]: [orderPostponed(telegramNotifier)],
    [Hooks.OrderRejected]: [orderRejected(telegramNotifier)],
  },

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
      [ChainId.Avalanche]: ['0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB'],
      [ChainId.BSC]: ['0x2170Ed0880ac9A755fd29B2688956BD959F933F8'],
      [ChainId.Ethereum]: ['0x0000000000000000000000000000000000000000'],
      [ChainId.Polygon]: ['0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619']
    }),
  ],

  tokenPriceService: new CachePriceFeed(
    new CoingeckoPriceFeed(process?.env?.COINGECKO_API_KEY),
    60 * 5 // 5min cache
  ),

  orderProcessor: processors.universalProcessor({
    minProfitabilityBps: 4,
  }),

  chains: [
    {
      chain: ChainId.Solana,
      chainRpc: `${process.env.SOLANA_RPC}`,

      beneficiary: `${process.env.SOLANA_BENEFICIARY}`,
      takerPrivateKey: `${process.env.SOLANA_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.SOLANA_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.Arbitrum,
      chainRpc: `${process.env.ARBITRUM_RPC}`,

      beneficiary: `${process.env.ARBITRUM_BENEFICIARY}`,
      takerPrivateKey: `${process.env.ARBITRUM_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.ARBITRUM_UNLOCK_AUTHORITY_PRIVATE_KEY}`,

      constraints: {
        requiredConfirmationsThresholds: [
          {thresholdAmountInUSD: 100, minBlockConfirmations: 1},
        ]
      },
    },

    {
      chain: ChainId.Avalanche,
      chainRpc: `${process.env.AVALANCHE_RPC}`,

      beneficiary: `${process.env.AVALANCHE_BENEFICIARY}`,
      takerPrivateKey: `${process.env.AVALANCHE_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.AVALANCHE_UNLOCK_AUTHORITY_PRIVATE_KEY}`,

      constraints: {
        requiredConfirmationsThresholds: [
          {thresholdAmountInUSD: 100, minBlockConfirmations: 1},
        ]
      },
    },

    {
      chain: ChainId.BSC,
      chainRpc: `${process.env.BNB_RPC}`,

      beneficiary: `${process.env.BNB_BENEFICIARY}`,
      takerPrivateKey: `${process.env.BNB_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.BNB_UNLOCK_AUTHORITY_PRIVATE_KEY}`,

      constraints: {
        requiredConfirmationsThresholds: [
          {thresholdAmountInUSD: 100, minBlockConfirmations: 1},
        ]
      },
    },

    {
      chain: ChainId.Ethereum,
      chainRpc: `${process.env.ETHEREUM_RPC}`,

      beneficiary: `${process.env.ETHEREUM_BENEFICIARY}`,
      takerPrivateKey: `${process.env.ETHEREUM_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.ETHEREUM_UNLOCK_AUTHORITY_PRIVATE_KEY}`,

      constraints: {
        requiredConfirmationsThresholds: [
          {thresholdAmountInUSD: 100, minBlockConfirmations: 1},
        ]
      },
    },

    {
      chain: ChainId.Polygon,
      chainRpc: `${process.env.POLYGON_RPC}`,

      beneficiary: `${process.env.POLYGON_BENEFICIARY}`,
      takerPrivateKey: `${process.env.POLYGON_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.POLYGON_UNLOCK_AUTHORITY_PRIVATE_KEY}`,

      constraints: {
        requiredConfirmationsThresholds: [
          {thresholdAmountInUSD: 100, minBlockConfirmations: 1},
        ]
      },
    },
  ],
};

module.exports = config;
