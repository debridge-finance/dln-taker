import { Logger } from "pino";

import { ExecutorConfig } from "../config";
import { ProviderAdapter } from "../providers/provider.adapter";
import { ChainId, OrderData, OrderState, PMMClient, PriceTokenService } from "@debridge-finance/dln-client";
import Web3 from "web3";
import { helpers } from "@debridge-finance/solana-utils";
import {createClientLogger} from "../logger";

export class OrderProcessorContext {
  client: PMMClient;
  orderFulfilledMap: Map<string, boolean>;
  logger: Logger;
  providersForUnlock: Map<ChainId, ProviderAdapter>;
  providersForFulfill: Map<ChainId, ProviderAdapter>;
}

export class OrderProcessorInitContext {
  providersForFulfill: Map<ChainId, ProviderAdapter>;

  providersForUnlock: Map<ChainId, ProviderAdapter>;

  executorConfig: ExecutorConfig;
  logger: Logger;
}

/**
 * Represents an order fulfillment engine. Cannot be chained, but can be nested.
 *
 */
export abstract class OrderProcessor {
  protected chainId: ChainId;
  protected context: OrderProcessorInitContext;

  protected takeWeb3: Web3;

  abstract init(chainId: ChainId, context: OrderProcessorInitContext): Promise<void>;
  abstract process(
    orderId: string,
    order: OrderData,
    executorConfig: ExecutorConfig,
    context: OrderProcessorContext
  ): Promise<void>;

  protected async waitIsOrderFulfilled(orderId: string, order: OrderData, context: OrderProcessorContext, logger:Logger) {
    if (order.take.chainId === ChainId.Solana) {
      let state = await context.client.getTakeOrderStatus(
        orderId,
        order.take.chainId,
        {web3: this.takeWeb3!}
      );
      const limit = 10;
      let iteration = 0;
      while (state === null || state.status !== OrderState.Fulfilled) {
        if (iteration === limit) throw new Error("Failed to wait for order fulfillment, retries limit reached")
        state = await context.client.getTakeOrderStatus(
          orderId,
          order.take.chainId
        );
        logger.debug(`state=${JSON.stringify(state)}`);
        await helpers.sleep(2000);
        iteration += 1;
      }
    }

  }

  protected async getFee(order: OrderData, tokenPriceService: PriceTokenService, client: PMMClient, giveWeb3: Web3, logger: Logger) {
    const clientLogger = createClientLogger(logger);
    const [giveNativePrice, takeNativePrice] = await Promise.all([
      tokenPriceService!.getPrice(order.give.chainId, null, { logger: clientLogger }),
      tokenPriceService!.getPrice(order.take.chainId, null, { logger: clientLogger }),
    ]);
    const fees = await client.getTakerFlowCost(
      order,
      giveNativePrice,
      takeNativePrice,
      {giveWeb3: giveWeb3!, takeWeb3: this.takeWeb3!}
    );
    logger.debug(`fees=${JSON.stringify(fees)}`);
    return fees;
  }
}
