import { ChainId } from "@debridge-finance/dln-client";
import { ExecutorConfig } from "./src/config";
import * as validators from "./src/validators";
import * as processors from "./src/processors";

const config: ExecutorConfig = {
  //
  // Mind you must set the WebSocket server address in order to fetch new orders in realtime
  // For security reasons, put it to the .env file
  //
  orderFeed: `${process.env.WSS}`,

  validators: [
    validators.srcChainDefined(),
    validators.dstChainDefined(),

    validators.giveVsTakeUSDAmountsDifference(4 /*bps*/),
  ],

  chains: [
    {
      chain: ChainId.Solana,
      chainRpc: `${process.env.RPC_SOLANA}`,

      // base58 representation of a private key.
      // For security reasons, put it to the .env file
      takerPrivateKey: `${process.env.SOLANA_TAKER_PRIVATE_KEY}`,

      // base58 representation of a private key
      // For security reasons, put it to the .env file
      unlockAuthorityPrivateKey: `${process.env.SOLANA_TAKER_PRIVATE_KEY}`,

      // address
      // For security reasons, put it to the .env file
      beneficiary: `${process.env.SOLANA_BENEFICIARY}`,

      srcValidators: [],
      dstValidators: [],

      // Use "11111111111111111111111111111111" as native SOL address
      orderProcessor: processors.preswapProcessor(
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
      ),
    },

    {
      chain: ChainId.Polygon,
      chainRpc: `${process.env.RPC_POLYGON}`,

      takerPrivateKey: `${process.env.POLYGON_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.POLYGON_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
      beneficiary: `${process.env.POLYGON_BENEFICIARY}`,

      srcValidators: [],
      dstValidators: [],

      // Use "0x0000000000000000000000000000000000000000" as native ETH token
      // if you hold reserves in ETH
      orderProcessor: processors.preswapProcessor(
        "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC
      ),
    },

    {
      chain: ChainId.BSC,
      chainRpc: `${process.env.RPC_BNB}`,

      takerPrivateKey: `${process.env.BNB_TAKER_PRIVATE_KEY}`,
      unlockAuthorityPrivateKey: `${process.env.BNB_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
      beneficiary: `${process.env.BNB_BENEFICIARY}`,

      srcValidators: [],
      dstValidators: [],

      // Use "0x0000000000000000000000000000000000000000" as native ETH token
      // if you hold reserves in ETH
      orderProcessor: processors.preswapProcessor(
        "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", // BUSD
      ),
    },
  ],
};

module.exports = config;
