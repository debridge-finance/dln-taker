/* eslint-disable import/no-default-export -- Allowed to simplify configuration file */

import {
  ChainId,
} from "@debridge-finance/dln-client";

import { ExecutorLaunchConfig } from "./src/config";
import { CURRENT_ENVIRONMENT as environment } from "./src/environments";
import { WsNextOrder } from "./src/orderFeeds/ws.order.feed";
import * as processors from "./src/processors";
import configurator from "./src/configurator";

// sanity check to ensure that .env file is supplied
if (process.env.WS_API_KEY === undefined)
  throw new Error(`Missing WS_API_KEY environment variable. Did you managed to create the .env file based on sample.env?`)

const config: ExecutorLaunchConfig = {
  orderFeed: new WsNextOrder(environment.WSS, {
    headers: {
      Authorization: `Bearer ${process.env.WS_API_KEY}`,
    },
  } as any),

  buckets: [
    //
    // Setting the USDC bucket (all tokens are emitted by Circle Inc on every DLN supported chain)
    //
    {
      [ChainId.Arbitrum]: "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8",
      [ChainId.Avalanche]: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
      [ChainId.BSC]: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      [ChainId.Base]: ["0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca"],
      [ChainId.Ethereum]: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      [ChainId.Linea]: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
      [ChainId.Optimism]: '0x7f5c764cbc14f9669b88837ca1490cca17c31607',
      [ChainId.Polygon]: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
      [ChainId.Solana]: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    },
    //
    // Setting the ETH/wETH bucket
    //
    {
      [ChainId.Arbitrum]: '0x0000000000000000000000000000000000000000',
      [ChainId.Avalanche]: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB',
      [ChainId.Base]: '0x0000000000000000000000000000000000000000',
      [ChainId.BSC]: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
      [ChainId.Ethereum]: '0x0000000000000000000000000000000000000000',
      [ChainId.Linea]: '0x0000000000000000000000000000000000000000',
      [ChainId.Optimism]: '0x0000000000000000000000000000000000000000',
      [ChainId.Polygon]: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'
    },
  ],

  tokenPriceService: configurator.tokenPriceService({
    coingeckoApiKey: process?.env?.COINGECKO_API_KEY
  }),

  orderProcessor: processors.universalProcessor({
    // desired profitability. Setting a higher value would prevent dln-taker from fulfilling most orders because
    // the deBridge app and the API suggest users placing orders with as much margin as 4bps
    minProfitabilityBps: 4,

    // Number of orders (per every chain where orders are coming from and to) to accumulate to unlock them in batches
    // Min: 1; max: 10, default: 10.
    // This means that dln-taker would accumulate orders (that were fulfilled successfully) rather then unlock
    // them on the go, and would send a batch of unlock commands every time enough orders were fulfilled, dramatically
    // reducing the cost of the unlock command execution.
    // You can set a lesser value to unlock orders more frequently, however please note that this value directly
    // affects order profitability because the deBridge app and the API reserves the cost of unlock in the order's margin,
    // assuming that the order would be unlocked in a batch of size=10. Reducing the batch size to a lower value increases
    // your unlock costs and thus reduces order profitability, making them unprofitable most of the time.
    batchUnlockSize: 10,
  }),

  chains: [
    {
      chain: ChainId.Solana,
      chainRpc: `${process.env.SOLANA_RPC}`,

      // Defines constraints imposed on all orders coming from this chain
      constraints: {
        // Defines a TVL budget for orders coming from this chain that were fulfilled before getting guaranteedly finalized.
        nonFinalizedTVLBudget: 10_000,
      },

      // if the order is created on Solana and fulfilled on another chain (e.g. Ethereum),
      // unlocked funds will be sent to this Solana address
      beneficiary: `${process.env.SOLANA_BENEFICIARY}`,

      // if the order is created on another chain (e.g. Ethereum), dln-taker would attempt to fulfill
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

      // Defines constraints imposed on all orders coming from this chain
      constraints: {
        // Defines necessary and sufficient block confirmation thresholds per worth of order expressed in dollars.
        requiredConfirmationsThresholds: [
          // worth <$100: 1+ block confirmation
          // {thresholdAmountInUSD: 100, minBlockConfirmations: 1},

          // worth >$100: guaranteed block confirmations (15)
        ],

        // Defines a TVL hard cap for orders coming from this chain that were fulfilled before getting guaranteedly finalized.
        nonFinalizedTVLBudget: 10_000,
      },

      // if the order is created on Ethereum and fulfilled on another chain (e.g. Solana),
      // unlocked funds will be sent to this Ethereum address
      beneficiary: `${process.env.ARBITRUM_BENEFICIARY}`,

      // if the order is created on another chain (e.g. Solana), dln-taker would attempt to fulfill
      // this order on behalf of this address
      // Warn! base64 representation of a private key.
      // Warn! For security reasons, put it to the .env file
      takerPrivateKey: `${process.env.ARBITRUM_TAKER_PRIVATE_KEY}`,

      // if the order is created on another chain (e.g. Solana), dln-taker would unlock it
      // after successful fulfillment on behalf of this address
      // Warn! base64 representation of a private key.
      // Warn! For security reasons, put it to the .env file
      unlockAuthorityPrivateKey: `${process.env.ARBITRUM_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.Avalanche,
      chainRpc: `${process.env.AVALANCHE_RPC}`,

      constraints: {
        requiredConfirmationsThresholds: [
          // worth <$100: 1+ block confirmation
          // {thresholdAmountInUSD: 100, minBlockConfirmations: 1},

          // worth >$100: guaranteed block confirmations (15)
        ],

        // Defines a TVL hard cap for orders coming from this chain that were fulfilled before getting guaranteedly finalized.
        nonFinalizedTVLBudget: 10_000,
      },

      beneficiary: `${process.env.AVALANCHE_BENEFICIARY}`,
      takerPrivateKey: `${process.env.AVALANCHE_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.AVALANCHE_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.BSC,
      chainRpc: `${process.env.BNB_RPC}`,

      constraints: {
        requiredConfirmationsThresholds: [
          // worth <$100: 1+ block confirmation
          // {thresholdAmountInUSD: 100, minBlockConfirmations: 1},

          // worth >$100: guaranteed block confirmations (15)
        ],

        // Defines a TVL hard cap for orders coming from this chain that were fulfilled before getting guaranteedly finalized.
        nonFinalizedTVLBudget: 10_000,
      },

      beneficiary: `${process.env.BNB_BENEFICIARY}`,
      takerPrivateKey: `${process.env.BNB_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.BNB_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.Ethereum,
      chainRpc: `${process.env.ETHEREUM_RPC}`,

      constraints: {
        requiredConfirmationsThresholds: [
          // worth <$100: 1+ block confirmation
          // {thresholdAmountInUSD: 100, minBlockConfirmations: 1},

          // worth >$100: guaranteed block confirmations (15)
        ],

        // Defines a TVL hard cap for orders coming from this chain that were fulfilled before getting guaranteedly finalized.
        nonFinalizedTVLBudget: 10_000,
      },

      beneficiary: `${process.env.ETHEREUM_BENEFICIARY}`,
      takerPrivateKey: `${process.env.ETHEREUM_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.ETHEREUM_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.Polygon,
      chainRpc: `${process.env.POLYGON_RPC}`,

      constraints: {
        requiredConfirmationsThresholds: [
          // worth <$100: 32+ block confirmation
          // {thresholdAmountInUSD: 100, minBlockConfirmations: 1},

          // worth >$100: guaranteed block confirmations (256)
        ],

        // Defines a TVL hard cap for orders coming from this chain that were fulfilled before getting guaranteedly finalized.
        nonFinalizedTVLBudget: 10_000,
      },

      beneficiary: `${process.env.POLYGON_BENEFICIARY}`,
      takerPrivateKey: `${process.env.POLYGON_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.POLYGON_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.Linea,
      chainRpc: `${process.env.LINEA_RPC}`,

      constraints: {},

      beneficiary: `${process.env.LINEA_BENEFICIARY}`,
      takerPrivateKey: `${process.env.LINEA_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.LINEA_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    },

    {
      chain: ChainId.Base,
      chainRpc: `${process.env.BASE_RPC}`,

      constraints: {},

      beneficiary: `${process.env.BASE_BENEFICIARY}`,
      takerPrivateKey: `${process.env.BASE_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.BASE_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
      environment: {
        deBridgeContract: '0xc1656B63D9EEBa6d114f6bE19565177893e5bCBF'
      }
    },

    {
      chain: ChainId.Optimism,
      chainRpc: `${process.env.OPTIMISM_RPC}`,

      constraints: {},

      beneficiary: `${process.env.OPTIMISM_BENEFICIARY}`,
      takerPrivateKey: `${process.env.OPTIMISM_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.OPTIMISM_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    }
  ],
};

export default config;
