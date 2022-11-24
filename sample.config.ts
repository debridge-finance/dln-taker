import { ChainId } from "@debridge-finance/dln-client";
import { ChainConfig, ExecutorConfig } from "./src/config";
import * as validators from "./src/validators";
import * as processors from "./src/processors";

const config: ExecutorConfig = {
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

      environment: {
        deBridgeContract: "Lima82j8YvHFYe8qa4kGgb3fvPFEnR3PoV6UyGUpHLq",
        pmmSrc: "src3au6NwAGF8ntnJKdkcUJy3aQg1qHoJMCwyunDk9j",
        pmmDst: "dst3kkK8VJ1oU7QstWcKkRSU6s1YeopZxEJp9XfxqP7",
        solana: {
          debridgeSetting: "settFZVDbqC9zBmV2ZCBfNMCtTzia2R7mVeR6ccK2nN"
        }
      },

      // base58 representation of a private key
      takerPrivateKey: `${process.env.SOLANA_TAKER_PRIVATE_KEY}`,

      // base58 representation of a private key
      unlockAuthorityPrivateKey: `${process.env.SOLANA_UNLOCK_AUTHORITY_PRIVATE_KEY}`,

      // address
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

      // {{{ LIMA
      environment: {
        deBridgeContract: "0xa9a617e8BE4efb0aC315691D2b4dbEC94f5Bb27b",
        pmmSrc: "0x81BD33D37941F5912C9FB74c8F00FB8d2CaCa327",
        pmmDst: "0xceD226Cbc7B4473c7578E3b392427d09448f24Ae",
        evm: {
          forwarderContract: '0x4f824487f7C0AB5A6B8B8411E472eaf7dDef2BBd'
        }
      },
      // }}}

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
      chainRpc: "https://bsc-dataseed.binance.org",

      // {{{ LIMA
      environment: {
        deBridgeContract: "0xa9a617e8BE4efb0aC315691D2b4dbEC94f5Bb27b",
        pmmSrc: "0x81BD33D37941F5912C9FB74c8F00FB8d2CaCa327",
        pmmDst: "0xceD226Cbc7B4473c7578E3b392427d09448f24Ae",
        evm: {
          forwarderContract: '0xce1705632Ced3A1d18Ed2b87ECe5B74526f59b8A'
        }
      },
      // }}}

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
