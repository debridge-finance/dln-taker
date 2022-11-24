import { Logger } from "pino";

import { ExecutorConfig } from "../config";
import { ProviderAdapter } from "../providers/provider.adapter";
import { EvmAdapterProvider } from "../providers/evm.provider.adapter";
import { approve, isApproved } from "./utils/approve";
import { ChainId, OrderData, PMMClient } from "@debridge-finance/dln-client";

export class OrderProcessorContext {
  client: PMMClient;
  orderFulfilledMap: Map<string, boolean>;
  logger: Logger;
  providersForUnlock: Map<ChainId, ProviderAdapter>;
  providersForFulfill: Map<ChainId, ProviderAdapter>;
}

export class OrderProcessorInitContext {
  providers: Map<ChainId, ProviderAdapter>;
  executorConfig: ExecutorConfig;
}

/**
 * Represents an order fulfillment engine. Cannot be chained, but can be nested.
 *
 */
export abstract class OrderProcessor {
  protected chainId: ChainId;
  protected context: OrderProcessorInitContext;

  abstract init(chainId: ChainId, context: OrderProcessorInitContext): Promise<void>;
  abstract process(
    orderId: string,
    order: OrderData,
    executorConfig: ExecutorConfig,
    context: OrderProcessorContext
  ): Promise<void>;

  protected async approveToken(tokenAddress: string, contractAddress: string): Promise<void> {
    if (this.chainId === ChainId.Solana) return Promise.resolve();
    const { connection } = this.context.providers.get(this.chainId) as EvmAdapterProvider;
    const tokenIsApproved = await isApproved(connection, tokenAddress, contractAddress);
    if (!tokenIsApproved) {
      await approve(connection, tokenAddress, contractAddress);
    }

    return Promise.resolve();
  }
}
