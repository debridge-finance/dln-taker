import { ChainId, SwapConnector } from "@debridge-finance/pmm-client";
import axios from "axios";
import logger from "loglevel";

export class OneInchConnector implements SwapConnector {
  constructor(
    private readonly apiServerOneInch: string = "https://nodes.debridge.finance"
  ) {}

  async getSwap(request: {
    chainId: ChainId;
    fromTokenAddress: string;
    toTokenAddress: string;
    amount: string;
    fromAddress: string;
    destReceiver: string;
    slippage: number;
  }): Promise<{ data: string; to: string; value: string }> {
    if (
      request.fromTokenAddress === "0x0000000000000000000000000000000000000000"
    ) {
      request.fromTokenAddress = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    }

    if (
      request.toTokenAddress === "0x0000000000000000000000000000000000000000"
    ) {
      request.toTokenAddress = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    }

    const query = new URLSearchParams({
      fromTokenAddress: request.fromTokenAddress.toString(),
      toTokenAddress: request.toTokenAddress.toString(),
      amount: request.amount.toString(),
      fromAddress: request.fromAddress.toString(),
      destReceiver: request.destReceiver.toString(),
      slippage: request.slippage.toString(),
      disableEstimate: "true",
    });
    const url = `${this.apiServerOneInch}/v4.0/${
      request.chainId
    }/swap?${query.toString()}`;

    logger.log(`OneInchConnector getSwap url ${url}`);

    try {
      const response = await axios.get(url);
      logger.log(
        `OneInchConnector getSwap response ${JSON.stringify(response.data)}`
      );

      return {
        data: response.data.tx.data,
        to: response.data.tx.to,
        value: response.data.tx.value,
      };
    } catch (e) {
      logger.log(`OneInchConnector getSwap error ${e}`);
      throw e;
    }
  }

  async getEstimate(request: {
    chainId: ChainId;
    fromTokenAddress: string;
    toTokenAddress: string;
    amount: string;
  }): Promise<string> {
    if (
      request.fromTokenAddress === "0x0000000000000000000000000000000000000000"
    ) {
      request.fromTokenAddress = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    }

    if (
      request.toTokenAddress === "0x0000000000000000000000000000000000000000"
    ) {
      request.toTokenAddress = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    }

    const query = new URLSearchParams({
      fromTokenAddress: request.fromTokenAddress.toString(),
      toTokenAddress: request.toTokenAddress.toString(),
      amount: request.amount.toString(),
    });
    const url = `${this.apiServerOneInch}/v4.0/${
      request.chainId
    }/quote?${query.toString()}`;

    const response = await axios.get(url);

    return response.data.toTokenAmount;
  }
}
