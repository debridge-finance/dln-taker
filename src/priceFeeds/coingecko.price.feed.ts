import { ChainId } from "@debridge-finance/pmm-client";
import { PriceFeed } from "../interfaces";
import axios, {AxiosInstance} from "axios";
import logger from "loglevel";
import { helpers } from "@debridge-finance/solana-utils";
import { PublicKey } from "@solana/web3.js";
import {setupCache} from "axios-cache-adapter";

export class CoingeckoPriceFeed implements PriceFeed {
    private readonly domain;

    private readonly endpointTokenPrice = "/api/v3/simple/token_price/";

    private readonly endpointGasPrice = "/api/v3/simple/price";

    private readonly currency = "usd";

    private readonly api_key: string;

    private readonly axiosInstance: AxiosInstance;

    constructor(private token?: string) {
        this.axiosInstance = axios.create({
            adapter: setupCache({
                maxAge: 5 * 60 * 1000 // caching 5m
            }).adapter
        });
        if (token) {
            this.domain = "https://pro-api.coingecko.com";
            this.api_key = `&x_cg_pro_api_key=${token}`;
        } else {
            this.domain = "https://api.coingecko.com";
            this.api_key = "";
        }
    }

    async getUsdPriceWithDecimals(chainId: ChainId, token: string): Promise<number> {
        const coinGeckoChainId = this.getCoinGeckoChainId(chainId);
        let tokenAddress = token;
        if (chainId === ChainId.Solana) {
            tokenAddress = new PublicKey(helpers.hexToBuffer(tokenAddress)).toBase58();

            if (
                ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"].includes(
                    tokenAddress,
                )
            ) {
                return 1; //todo
            }
        } else {
            const evmNative = "0x0000000000000000000000000000000000000000";
            if (token === evmNative) return this.getGasPrice(chainId);
        }
        const url =
            this.domain +
            this.endpointTokenPrice +
            coinGeckoChainId +
            `?contract_addresses=${tokenAddress}&vs_currencies=${this.currency}`;
        logger.log("CoinGeckoPriceTokenService", "url", url);
        const response = await this.axiosInstance.get(url + this.api_key);
        logger.log("CoinGeckoPriceTokenService", "response", response.data);

        return response.data[tokenAddress][this.currency];
    }

    async getGasPrice(chainId: ChainId): Promise<number> {
        const getNativeCoinName = this.getNativeCoinName(chainId);
        const url = this.domain + this.endpointGasPrice + `?ids=${getNativeCoinName}&vs_currencies=${this.currency}`;
        logger.log("CoinGeckoPriceTokenService", "url", url);
        const response = await this.axiosInstance.get(url + this.api_key);
        logger.log("CoinGeckoPriceTokenService", "response", response.data);
        return response.data[getNativeCoinName][this.currency];
    }

    private getNativeCoinName(chainId: ChainId): string | never {
        switch (chainId) {
            case ChainId.Ethereum: {
                return "ethereum";
            }
            case ChainId.BSC: {
                return "binancecoin";
            }
            case ChainId.BSCTest: {
                return "binancecoin";
            }
            case ChainId.Heco: {
                return "huobi-token";
            }
            case ChainId.HecoTest: {
                return "huobi-token";
            }
            case ChainId.Polygon: {
                return "matic-network";
            }
            case ChainId.PolygonTest: {
                return "matic-network";
            }
            case ChainId.Arbitrum: {
                return "ethereum";
            }
            case ChainId.Avalanche: {
                return "avalanche-2";
            }
            case ChainId.AvalancheTest: {
                return "avalanche-2";
            }
            case ChainId.ArbitrumTest: {
                return "ethereum";
            }
            case ChainId.Solana: {
                return "solana";
            }
            case ChainId.Fantom: {
                return "fantom";
            }
        }
        throw new Error("UnsupportedChain");
    }

    private getCoinGeckoChainId(chainId: ChainId): string | never {
        switch (chainId) {
            case ChainId.Ethereum: {
                return "ethereum";
            }
            case ChainId.BSC: {
                return "binance-smart-chain";
            }
            case ChainId.BSCTest: {
                return "binance-smart-chain";
            }
            case ChainId.Heco: {
                return "huobi-token";
            }
            case ChainId.HecoTest: {
                return "huobi-token";
            }
            case ChainId.Polygon: {
                return "polygon-pos";
            }
            case ChainId.PolygonTest: {
                return "polygon-pos";
            }
            case ChainId.Arbitrum: {
                return "arbitrum-one";
            }
            case ChainId.Avalanche: {
                return "avalanche";
            }
            case ChainId.AvalancheTest: {
                return "avalanche";
            }
            case ChainId.ArbitrumTest: {
                return "arbitrum-one";
            }
            case ChainId.Solana: {
                return "solana";
            }
            case ChainId.Fantom: {
                return "fantom";
            }
        }
        throw new Error("UnsupportedChain");
    }
}
