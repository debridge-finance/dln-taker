import {ChainId, ZERO_EVM_ADDRESS} from "@debridge-finance/pmm-client";
import { ChainConfig, ExecutorConfig } from "./src/config";
import * as validators from "./src/validators";
import * as processors from "./src/processors";

const config: ExecutorConfig = {
  orderFeed: `${process.env.WSS}`,

  validators: [
    validators.srcChainDefined(),
    validators.dstChainDefined(),

    validators.orderProfitable(4 /*bps*/),
  ],

  chains: [
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

      takerPrivateKey: `0bd41658b28582347636ed6b1cbf2212f3e0a51c671df1b8bb205eb067c19b7b`,
      beneficiary: `0xE5164DdE788A150Bee9E4EFeeB37ab774EDd618b`,

      srcValidators: [],
      dstValidators: [],

      // fulfill only orders with takeToken=MATIC
      orderProcessor: processors.preswapProcessor("0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", 2),
    },

    {
      chain: ChainId.BSC,
      chainRpc: "https://bsc-dataseed3.defibit.io/",

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

      takerPrivateKey: `0bd41658b28582347636ed6b1cbf2212f3e0a51c671df1b8bb205eb067c19b7b`,
      beneficiary: `0xE5164DdE788A150Bee9E4EFeeB37ab774EDd618b`,

      srcValidators: [],
      dstValidators: [],

      // fulfill orders making preswap from BNB

      orderProcessor: processors.strictProcessor(
        [ZERO_EVM_ADDRESS],
      )
     /*orderProcessor: processors.preswapProcessor(
        "0x14016E85a25aeb13065688cAFB43044C2ef86784",
        3
      ),*/
    },
    {
      chain: ChainId.Solana,
      chainRpc: "https://solana-rpc-node.debridge.finance/",

      // {{{ LIMA
      environment: {
        deBridgeContract: "Lima82j8YvHFYe8qa4kGgb3fvPFEnR3PoV6UyGUpHLq",
        pmmSrc: 'src3au6NwAGF8ntnJKdkcUJy3aQg1qHoJMCwyunDk9j',
        pmmDst: 'dst3kkK8VJ1oU7QstWcKkRSU6s1YeopZxEJp9XfxqP7',
        solana: {
          debridgeSetting: 'settFZVDbqC9zBmV2ZCBfNMCtTzia2R7mVeR6ccK2nN'
        }
      },
      // }}}

      takerPrivateKey: '0xc3ad05a78f4696f92fd4b23a141e91e0b894aefb26371dc52d7dc702a12ccb71466dc857bcb150c0218cec8e58358583727d208ada43a59eff994b97fe10c7f4',
      beneficiary: '5jvdc6LsMoFH7pU5LagXm5VZiG2m4MH4KhzRvoRtZVHu',

      srcValidators: [],
      dstValidators: [],

      // fulfill orders making preswap from BNB

      orderProcessor: processors.preswapProcessor(
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 3
      )
      /* orderProcessor: processors.preswapProcessor(
         "0x14016E85a25aeb13065688cAFB43044C2ef86784",
         3
       ),*/
    },
  ],
};

module.exports = config;
