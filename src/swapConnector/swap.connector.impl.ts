import {ChainId, SwapConnector, SwapResponse } from '@debridge-finance/dln-client';
import { PublicKey } from '@solana/web3.js';
import { JupiterWrapper } from './jupiter.wrapper';
import { OneInchConnector } from './one.inch.connector';

export class SwapConnectorImpl implements SwapConnector {
  constructor(
    private readonly oneInchConnector: OneInchConnector,
    private _jupiterWrapper: JupiterWrapper,
  ) {}

  get jupiterWrapper() {
    return this._jupiterWrapper;
  }

  async getSwap<Chain>(request: {
    chainId: ChainId;
    fromTokenAddress: Uint8Array;
    toTokenAddress: Uint8Array;
    amount: string;
    fromAddress: Uint8Array | undefined;
    destReceiver: Uint8Array | undefined;
    slippageBps: number;
  }): Promise<SwapResponse<Chain>> {
    let result: any
    if (request.chainId === ChainId.Solana) {
      const slippage = 1;
      const stableCoinMint = new PublicKey(request.toTokenAddress);
      const route = await this._jupiterWrapper.findExactInRoutes(
        new PublicKey(request.fromTokenAddress),
        stableCoinMint,
        BigInt(request.amount),
        slippage * 100,
      );
      result = {
        route,
      } as SwapResponse<ChainId.Solana>;
    } else {
      result = await this.oneInchConnector.getSwap(request);
    }
    return result;
  }

  async getEstimate(request: {
    chainId: ChainId;
    fromTokenAddress: Uint8Array;
    toTokenAddress: Uint8Array;
    amount: string;
  }): Promise<string> {
    if (request.chainId === ChainId.Solana) {
      const slippage = 1;
      const stableCoinMint = new PublicKey(request.toTokenAddress);
      return (
        await this._jupiterWrapper.findExactInRoutes(
          new PublicKey(request.fromTokenAddress),
          stableCoinMint,
          BigInt(request.amount),
          slippage * 100,
        )
      )!.outAmount.toString();
    } else {
      return this.oneInchConnector.getEstimate(request);
    }
  }
}
