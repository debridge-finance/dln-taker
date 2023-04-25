import { ChainId } from "@debridge-finance/dln-client";

export type DlnPreFulfillSwapSlippageOverridesChainInfo = {
  /**
   * Defines default minimal slippage buffer (in bps) for pre-fulfill swaps,
   * to reduce the number of potential swap reverts, for this particular chain
   */
  slippageBps?: number;
  perTokenIn?: {
    [key in string]?: DlnPreFulfillSwapSlippageOverridesTokenInInfo
  }
};

export type DlnPreFulfillSwapSlippageOverridesTokenInInfo = {
  /**
   * Defines default minimal slippage buffer (in bps) for pre-fulfill swaps,
   * to reduce the number of potential swap reverts, for this particular chain
   * AND this particular tokenIn
   */
  slippageBps?: number;
  overrides?: Array<{
    /**
     * Defines default minimal slippage buffer (in bps) for pre-fulfill swaps,
     * to reduce the number of potential swap reverts, for this particular chain
     * AND this particular tokenIn
     * AND this particular tokenOut
     */
    slippageBps: number,
    tokensOut: Array<string>,
  }>
};


export type DlnPreFulfillSwapSlippageOverrides = {
  /**
   * Defines default minimal slippage buffer (in bps) for pre-fulfill swaps,
   * to reduce the number of potential swap reverts
   */
  slippageBps?: number;

  perChain?: {
    [key in ChainId]?: DlnPreFulfillSwapSlippageOverridesChainInfo
  }
};