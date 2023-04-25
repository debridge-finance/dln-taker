import {
  ChainId,
  PMMClient,
  SlippageOverloaderFunc,
  Logger,
  tokenStringToBuffer,
  buffersAreEqual,
  tokenAddressToString
} from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";
import Web3 from "web3";
import {
  DlnPreFulfillSwapSlippageOverrides,
  DlnPreFulfillSwapSlippageOverridesChainInfo, DlnPreFulfillSwapSlippageOverridesTokenInInfo
} from "../types/DlnPreFulfillSwapSlippageOverrides";

export class SlippageOverrideService {

  private readonly configs: DlnPreFulfillSwapSlippageOverrides[];

  constructor(localConfig: DlnPreFulfillSwapSlippageOverrides, baseConfig: DlnPreFulfillSwapSlippageOverrides) {
    this.configs = [localConfig, baseConfig];
  }

  createSlippageOverloaderFunc(): SlippageOverloaderFunc {
    return (
      client: PMMClient,
      chain: ChainId,
      tokenIn: Uint8Array,
      tokenInAmount: BigNumber,
      tokenOut: Uint8Array,
      tokenOutAmount: BigNumber,
      calculatedPriceDrop: number,
      calculatedSlippage: number,
      context: { logger: Logger; web3?: Web3 },
    ) => {
      for (const config of this.configs) {
        const slippage = this.calculateSlippage(config,
          client,
          chain,
          tokenIn,
          tokenInAmount,
          tokenOut,
          tokenOutAmount,
          calculatedPriceDrop,
          calculatedSlippage,
          context
        );
        if (slippage) {
          return slippage;
        }
      }
      return null;
    };
  };

  private calculateSlippage(config: DlnPreFulfillSwapSlippageOverrides,
                                      client: PMMClient,
                                      chain: ChainId,
                                      tokenIn: Uint8Array,
                                      tokenInAmount: BigNumber,
                                      tokenOut: Uint8Array,
                                      tokenOutAmount: BigNumber,
                                      calculatedPriceDrop: number,
                                      calculatedSlippage: number,
                                      context: { logger: Logger; web3?: Web3 },) {
    const chainConfig = this.getChainConfig(config, chain, context.logger);
    if (!chainConfig) return config.slippageBps;

    const tokenInConfig = this.getTokenInInfo(chainConfig, chain, tokenIn, context.logger);
    if (!tokenInConfig) return chainConfig.slippageBps || config.slippageBps;

    if (!tokenInConfig.overrides) return tokenInConfig.slippageBps || chainConfig.slippageBps || config.slippageBps;

    const slippageConfig = tokenInConfig.overrides.find((config) => {
      return !!config.tokensOut.find((tokenOutInConfig) => {
        const tokenOutInConfigInBuffer = tokenStringToBuffer(
          chain,
          tokenOutInConfig,
        );
        return buffersAreEqual(tokenOutInConfigInBuffer, tokenOut);
      });
    });

    if (!slippageConfig) {
      const tokenInString = tokenAddressToString(chain, tokenIn);
      const tokenOutString = tokenAddressToString(chain, tokenOut);
      context.logger.verbose(
        `[SlippageOverloader] tokenOut ${tokenOutString} in tokenIn ${tokenInString} in chain ${chain} is not configured`,
      );
      return tokenInConfig.slippageBps || chainConfig.slippageBps || config.slippageBps;
    }

    return slippageConfig.slippageBps || tokenInConfig.slippageBps || chainConfig.slippageBps || config.slippageBps;
  }

  private getChainConfig(config: DlnPreFulfillSwapSlippageOverrides, chain: ChainId, logger: Logger): DlnPreFulfillSwapSlippageOverridesChainInfo|undefined {
    if (!config.perChain) {
      logger.verbose(
        `[SlippageOverloader] chains is not configured`,
      );
      return undefined;
    }
    const chainConfig = config.perChain[chain];
    if (!chainConfig) {
      logger.verbose(
        `[SlippageOverloader] chain ${chain} is not configured`,
      );
      return undefined;
    }
    return chainConfig;
  }

  private getTokenInInfo(chainConfig: DlnPreFulfillSwapSlippageOverridesChainInfo, chain: ChainId, tokenIn: Uint8Array, logger: Logger): DlnPreFulfillSwapSlippageOverridesTokenInInfo | undefined {
    if (!chainConfig.perTokenIn) {
      logger.verbose(
        `[SlippageOverloader] perTokenIn in chain ${chain} is not configured`,
      );
      return undefined;
    }
    const tokenInKey = Object.keys(chainConfig.perTokenIn).find((tokenInInChain) => {
      const tokenInInChainInBuffer = tokenStringToBuffer(chain, tokenInInChain);
      return buffersAreEqual(tokenInInChainInBuffer, tokenIn);
    });
    const tokenInString = tokenAddressToString(chain, tokenIn);
    if (!tokenInKey) {
      logger.verbose(
        `[SlippageOverloader] tokenIn ${tokenInString} in chain ${chain} is not configured`,
      );
      return undefined;
    }
    return chainConfig.perTokenIn[tokenInKey];
  }
}