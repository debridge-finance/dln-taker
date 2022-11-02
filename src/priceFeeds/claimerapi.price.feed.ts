import { ChainId } from "@debridge-finance/pmm-client";
import { PriceFeed } from "../interfaces";

export class CalimerApi implements PriceFeed {
    async getUsdPrice(chainId: ChainId, tokenAddress: string): Promise<number> {
        console.log(`Getting price of token: ${tokenAddress}, chain: ${chainId}`);
        const query = `https://claimerapi.debridge.io/TokenPrice/usd_price?chainId=${chainId}&tokenAddress=${tokenAddress}`;
        console.log(query);
        // @ts-ignore
        const response = await fetch(query);
        if (response.status === 200) {
            return Number(await response.text());
        } else {
            const parsedJson = (await response.json()) as { message: string };
            throw new Error(parsedJson.message);
        }
    }
}