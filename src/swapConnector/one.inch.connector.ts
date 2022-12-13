import axios from 'axios';
import {ChainId, Logger, tokenAddressToString} from '@debridge-finance/dln-client';

export class OneInchConnector {
  constructor(private readonly apiServerOneInch: string) {}

  async getSwap(request: {
    chainId: ChainId;
    fromTokenAddress: Uint8Array;
    toTokenAddress: Uint8Array;
    amount: string;
    fromAddress: Uint8Array | undefined;
    destReceiver: Uint8Array | undefined;
    slippageBps: number;
  }, context: { logger: Logger }): Promise<{ data: string; to: string; value: string }> {
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
      fromAddress: tokenAddressToString(request.chainId, request.fromAddress!),
      destReceiver: tokenAddressToString(request.chainId, request.destReceiver!),
      slippage: (request.slippageBps / 10_000).toString(),
      disableEstimate: 'true',
    });
    const url = `${this.apiServerOneInch}/v4.0/${
      request.chainId
    }/swap?${query.toString()}`;

    context?.logger?.log(url);

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
  }, context: { logger: Logger }): Promise<string> {
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

    context?.logger?.log(url);

    const response = await axios.get(url);

    return response.data.toTokenAmount;
  }
}
