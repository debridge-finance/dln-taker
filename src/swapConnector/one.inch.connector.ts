import axios from 'axios';
import {
  ChainId,
  Solana,
  SwapConnector,
  tokenAddressToString,
} from '@debridge-finance/dln-client';
import { PublicKey } from '@solana/web3.js';

export class OneInchConnector implements SwapConnector {
  constructor(
    private readonly apiServerOneInch: string,
    private readonly solanaClient: Solana.PmmClient,
  ) {}

  async getSwap(request: {
    chainId: ChainId;
    fromTokenAddress: Uint8Array;
    toTokenAddress: Uint8Array;
    amount: string;
    fromAddress: Uint8Array;
    destReceiver: Uint8Array;
    slippage: number;
  }): Promise<{ data: string; to: string; value: string }> {
    if (request.chainId === ChainId.Solana) {
      throw new Error('Not implemented');
    }
    const fromTokenAddress = this.fix1inchNativeAddress(
      request.chainId,
      request.fromTokenAddress,
    );
    const toTokenAddress = this.fix1inchNativeAddress(
      request.chainId,
      request.toTokenAddress,
    );

    const query = new URLSearchParams({
      fromTokenAddress,
      toTokenAddress,
      amount: request.amount.toString(),
      fromAddress: tokenAddressToString(request.chainId, request.fromAddress),
      destReceiver: tokenAddressToString(request.chainId, request.destReceiver),
      slippage: request.slippage.toString(),
      disableEstimate: 'true',
    });
    const url = `${this.apiServerOneInch}/v4.0/${
      request.chainId
    }/swap?${query.toString()}`;

    console.log(url);

    const response = await axios.get(url);

    return {
      data: response.data.tx.data,
      to: response.data.tx.to,
      value: response.data.tx.value,
    };
  }

  private fix1inchNativeAddress(chainId: ChainId, token: Uint8Array) {
    let address = tokenAddressToString(chainId, token);
    if (address === '0x0000000000000000000000000000000000000000') {
      address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
    }
    return address;
  }

  async getEstimate(request: {
    chainId: ChainId;
    fromTokenAddress: Uint8Array;
    toTokenAddress: Uint8Array;
    amount: string;
    slippage?: number;
  }): Promise<string> {
    if (request.chainId === ChainId.Solana) {
      const stableCoinMint = new PublicKey(request.toTokenAddress);
      const router = await this.solanaClient.jupiter!.findExactInRoutes(
        new PublicKey(request.fromTokenAddress),
        stableCoinMint,
        BigInt(request.amount),
        request.slippage! * 100,
      );
      return router!.outAmount.toString();
    }

    const fromTokenAddress = this.fix1inchNativeAddress(
      request.chainId,
      request.fromTokenAddress,
    );
    const toTokenAddress = this.fix1inchNativeAddress(
      request.chainId,
      request.toTokenAddress,
    );

    const query = new URLSearchParams({
      fromTokenAddress,
      toTokenAddress,
      amount: request.amount.toString(),
    });
    const url = `${this.apiServerOneInch}/v4.0/${
      request.chainId
    }/quote?${query.toString()}`;

    console.log(url);

    const response = await axios.get(url);

    return response.data.toTokenAmount;
  }
}
