import { ChainId } from "@debridge-finance/pmm-client";

import { ChainConfig, ExecutorConfig } from "./config";
import { ExecutorEngine } from "./executor.engine";
import { WsNextOrder } from "./orderFeeds/ws.order.feed";
import { preswapProcessor } from "./processors/preswap.proccessor";
import { strictProcessor } from "./processors/strict.processor";
import { disableFulfill } from "./validators/disable.fulfill";
import { whiteListedMarker } from "./validators/white.listed.marker";

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function main() {
  const config = [
    {
      // orderProcessor: strictProcessor(['0x0000000000000000000000000000000000000000']),

      validators: [
        whiteListedMarker([
          `${process.env.BENEFICIARY}`,
          "0x4f824487f7c0ab5a6b8b8411e472eaf7ddef2bbd",
        ]),
      ],

      orderFeed: new WsNextOrder("wss://lima-pmm-ws.debridge.io/ws"),
      chains: [
        {
          chain: ChainId.Polygon,
          chainRpc:
            "https://polygon-mainnet.infura.io/v3/deec1f0db8aa4960882206b0ef38e4a8",
          environment: {
            deBridgeContract: "0xa9a617e8BE4efb0aC315691D2b4dbEC94f5Bb27b",
            pmmSrc: "0x81BD33D37941F5912C9FB74c8F00FB8d2CaCa327",
            pmmDst: "0xceD226Cbc7B4473c7578E3b392427d09448f24Ae",
            evm: {
              forwarderContract: '0x4f824487f7C0AB5A6B8B8411E472eaf7dDef2BBd'
            }
          },
          takerPrivateKey: `${process.env.TAKER_PRIVATE_KEY}`,
          beneficiary: `${process.env.BENEFICIARY}`,
          orderProcessor: strictProcessor([
            "0x0000000000000000000000000000000000000000",
          ]),
          srcValidators: [
            // disableFulfill(),
          ],
          dstValidators: [],
        } as ChainConfig,
        {
          chain: ChainId.BSC,
          chainRpc: "https://bsc-dataseed.binance.org",
          environment: {
            deBridgeContract: "0xa9a617e8BE4efb0aC315691D2b4dbEC94f5Bb27b",
            pmmSrc: "0x81BD33D37941F5912C9FB74c8F00FB8d2CaCa327",
            pmmDst: "0xceD226Cbc7B4473c7578E3b392427d09448f24Ae",
            evm: {
              forwarderContract: '0xce1705632Ced3A1d18Ed2b87ECe5B74526f59b8A'
            },
          },
          takerPrivateKey: `${process.env.TAKER_PRIVATE_KEY}`,
          beneficiary: `${process.env.BENEFICIARY}`,
          // orderProcessor: preswapProcessor('0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', 1),
          orderProcessor: preswapProcessor(
            "0x0000000000000000000000000000000000000000",
            3
          ),
          dstValidators: [
            // disableFulfill(),
          ],
        } as ChainConfig,
        {
          chain: ChainId.Solana,
          chainRpc: 'https://solana-rpc-node.debridge.finance',
          environment: {
            pmmSrc: "src3au6NwAGF8ntnJKdkcUJy3aQg1qHoJMCwyunDk9j",
            pmmDst: "dst3kkK8VJ1oU7QstWcKkRSU6s1YeopZxEJp9XfxqP7",
            solana: {
              solanaDebridge: 'Lima82j8YvHFYe8qa4kGgb3fvPFEnR3PoV6UyGUpHLq',
              solanaDebridgeSetting: 'settFZVDbqC9zBmV2ZCBfNMCtTzia2R7mVeR6ccK2nN'
            }
          },
          takerPrivateKey: '0xc3ad05a78f4696f92fd4b23a141e91e0b894aefb26371dc52d7dc702a12ccb71466dc857bcb150c0218cec8e58358583727d208ada43a59eff994b97fe10c7f4',
          beneficiary: '5jvdc6LsMoFH7pU5LagXm5VZiG2m4MH4KhzRvoRtZVHu',
          orderProcessor: preswapProcessor('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 1),
          dstValidators: [
            whiteListedMarker(['0x54b34941F094EBdd970a6e67eEB7D86C07612AD6']),
          ]
        } as ChainConfig
      ],
    } as ExecutorConfig,
  ];

  const executor = new ExecutorEngine(config)
  await executor.init();
  await executor.start();
}

main()
  .catch(e => console.error("Executor failed:", (e as Error).message))
