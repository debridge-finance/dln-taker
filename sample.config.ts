import { ChainId } from "@debridge-finance/pmm-client";
import { ChainConfig, ExecutorConfig } from "./src/config";
import * as validators from "./src/validators";
import * as processors from "./src/processors";

const config: ExecutorConfig = {
  orderFeed: `${process.env.WSS}`,

  orderValidators: [
    validators.orderProfitable(4),
  ],

  chains: [
    {
      chain: ChainId.Polygon,
      chainRpc: `${process.env.RPC_POLYGON}`,

      // {{{ LIMA
      crossChainForwarderAddress: "0x4f824487f7C0AB5A6B8B8411E472eaf7dDef2BBd",
      deBridge: "0xa9a617e8BE4efb0aC315691D2b4dbEC94f5Bb27b",
      pmmSrc: "0x81BD33D37941F5912C9FB74c8F00FB8d2CaCa327",
      pmmDst: "0xceD226Cbc7B4473c7578E3b392427d09448f24Ae",
      // }}}

      takerPrivateKey: `${process.env.TAKER_PRIVATE_KEY}`,
      beneficiary: `${process.env.BENEFICIARY}`,

      srcValidators: [],
      dstValidators: [],

      // fulfill only orders with takeToken=MATIC
      orderProcessor: processors.strictProcessor([
        "0x0000000000000000000000000000000000000000",
      ]),
    },

    {
      chain: ChainId.BSC,
      chainRpc: "https://bsc-dataseed.binance.org",

      // {{{ LIMA
      crossChainForwarderAddress: "0xce1705632Ced3A1d18Ed2b87ECe5B74526f59b8A",
      deBridge: "0xa9a617e8BE4efb0aC315691D2b4dbEC94f5Bb27b",
      pmmSrc: "0x81BD33D37941F5912C9FB74c8F00FB8d2CaCa327",
      pmmDst: "0xceD226Cbc7B4473c7578E3b392427d09448f24Ae",
      // }}}

      takerPrivateKey: `${process.env.TAKER_PRIVATE_KEY}`,
      beneficiary: `${process.env.BENEFICIARY}`,

      srcValidators: [],
      dstValidators: [],

      // fulfill orders making preswap from BNB
      orderProcessor: processors.preswapProcessor(
        "0x0000000000000000000000000000000000000000",
        3
      ),
    },
  ],
};

module.exports = config;
