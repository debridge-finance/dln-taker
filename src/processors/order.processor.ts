import {
  ChainId,
  OrderData,
  OrderState,
  TokensBucket,
} from "@debridge-finance/dln-client";
import { helpers } from "@debridge-finance/solana-utils";
import { Logger } from "pino";
import Web3 from "web3";

import {
  ExecutorConf,
  InitializingChain,
  SupportedChainConfig,
} from "../executor";
import { createClientLogger } from "../logger";

export class OrderProcessorContext {
  orderFulfilledMap: Map<string, boolean>;
  logger: Logger;

  config: ExecutorConf;
  giveChain: SupportedChainConfig;
  takeChain: SupportedChainConfig;
}

export class OrderProcessorInitContext {
  chain: InitializingChain;
  buckets: TokensBucket[];
  logger: Logger;
}

export type OrderProcessorInitializer = (
  chainId: ChainId,
  context: OrderProcessorInitContext
) => Promise<OrderProcessor>;

/**
 * Represents an order fulfillment engine. Cannot be chained, but can be nested.
 *
 */
export abstract class OrderProcessor {
  protected chainId: ChainId;
  protected context: OrderProcessorInitContext;

  abstract init(
    chainId: ChainId,
    context: OrderProcessorInitContext
  ): Promise<void>;
  abstract process(
    orderId: string,
    order: OrderData,
    context: OrderProcessorContext
  ): Promise<boolean>;

  protected async waitIsOrderFulfilled(
    orderId: string,
    order: OrderData,
    context: OrderProcessorContext,
    logger: Logger
  ) {
    if (order.take.chainId === ChainId.Solana) {
      let state = await context.config.client.getTakeOrderStatus(
        orderId,
        order.take.chainId,
        { web3: context.takeChain.fulfullProvider.connection as Web3 }
      );
      const limit = 10;
      let iteration = 0;
      while (state === null || state.status !== OrderState.Fulfilled) {
        if (iteration === limit)
          throw new Error(
            "Failed to wait for order fulfillment, retries limit reached"
          );
        state = await context.config.client.getTakeOrderStatus(
          orderId,
          order.take.chainId
        );
        logger.debug(`state=${JSON.stringify(state)}`);
        await helpers.sleep(2000);
        iteration += 1;
      }
    }
  }

  protected async getFee(order: OrderData, context: OrderProcessorContext) {
    const clientLogger = createClientLogger(context.logger);
    const [giveNativePrice, takeNativePrice] = await Promise.all([
      context.config.tokenPriceService.getPrice(order.give.chainId, null, {
        logger: clientLogger,
      }),
      context.config.tokenPriceService.getPrice(order.take.chainId, null, {
        logger: clientLogger,
      }),
    ]);
    const fees = await context.config.client.getTakerFlowCost(
      order,
      giveNativePrice,
      takeNativePrice,
      {
        giveWeb3: context.giveChain.fulfullProvider.connection as Web3,
        takeWeb3: context.takeChain.fulfullProvider.connection as Web3,
      }
    );
    context.logger.debug(`fees=${JSON.stringify(fees)}`);
    return fees;
  }
}
