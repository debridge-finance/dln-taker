import { ChainId } from "@debridge-finance/pmm-client";
import { ExecutorConfig } from "./src/config";
import { matchProcessor, preswapProcessor } from "./src/processors";
import { giveAmountDollarEquiv, giveTokenIsAllowed, orderIsProfitable, srcChainIsRegistered, takeAmountDollarEquiv } from "./src/validators";

const config: ExecutorConfig = {
    orderFeed: "ws://127.0.0.1/ws",

    fulfillableChains: [
        {
            chain: ChainId.Polygon,
            chainRpc: "https://polygon-mainnet.infura.io/v3/deec1f0db8aa4960882206b0ef38e4a8",

            // { this should not be presented in a real config: mainnet addresses must be hardcoded
                pmmSrc: "0x4ad114182dDAb072246ED76Ea21488c673A2127C",
                pmmDst: "0x17Fc2d1E24E9444EF76e5D092324BB2c4cb4108E",
                deBridge: "0x2762E725546D3eac7548C285C35b3fee19e93eA3",
            // }

            beneficiary: "0x441BC84aa07a71426f4D9A40Bc40aC7183D124B9",
            wallet: "1234....",

            whitelistedGiveTokens: [
                '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' // usdc
            ],

            orderValidators: [
                srcChainIsRegistered(),
                giveTokenIsAllowed(),
                orderIsProfitable(4),
                takeAmountDollarEquiv(0, 1000),
            ],

            // preswap from USDC
            orderProcessor: preswapProcessor('0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174')
        },

        {
            chain: ChainId.Solana,
            chainRpc: "https://api.mainnet-beta.solana.com/",

            // { this should not be presented in a real config: mainnet addresses must be hardcoded
                pmmSrc: "srcTG7YiZkebpJJaCQEuqBznRYqrfcj8a917EcMnNUk",
                pmmDst: "dstFoo3xGxv23giLZBuyo9rRwXHdDMeySj7XXMj1Rqn",
                deBridge: "F1nSne66G8qCrTVBa1wgDrRFHMGj8pZUZiqgxUrVtaAQ",
                deBridgeSettings: "14bkTTDfycEShjiurAv1yGupxvsQcWevReLNnpzZgaMh",
            // }

            beneficiary: "abc312",
            wallet: "1234....",

            whitelistedGiveTokens: "ANY",

            orderValidators: [
                srcChainIsRegistered(),
                orderIsProfitable(4),
                giveTokenIsAllowed(),
                takeAmountDollarEquiv(0, 1000),
            ],

            // match as is
            orderProcessor: matchProcessor()
        },
    ]
}

module.exports = config;