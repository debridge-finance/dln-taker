import {
  ChainId,
  OrderData,
  OrderState,
} from "@debridge-finance/dln-client";
import { helpers } from "@debridge-finance/solana-utils";
import { Logger } from "pino";

import {
  ExecutorInitializingChain,
  ExecutorSupportedChain,
  IExecutor,
} from "../executors/executor";
import { IncomingOrderContext } from "../interfaces";
import { HooksEngine } from "../hooks/HooksEngine";
import { TokensBucket } from "@debridge-finance/legacy-dln-profitability";

export type OrderId = string;

export class OrderProcessorContext {
  logger: Logger;
  config: IExecutor;
  giveChain: ExecutorSupportedChain;
  takeChain: ExecutorSupportedChain;
}

export class OrderProcessorInitContext {
  takeChain: ExecutorInitializingChain;
  buckets: TokensBucket[];
  logger: Logger;
  hooksEngine: HooksEngine;
  contractsForApprove: string[];
}

export type OrderProcessorInitializer = (
  chainId: ChainId,
  executor: IExecutor,
  context: OrderProcessorInitContext
) => Promise<IOrderProcessor>;

export interface IOrderProcessor {
  process(params: IncomingOrderContext): Promise<void>;
}

/**
 * Represents an order fulfillment engine. Cannot be chained, but can be nested.
 *
 */
export abstract class BaseOrderProcessor implements IOrderProcessor {
  protected chainId: ChainId;
  protected takeChain: ExecutorInitializingChain;
  protected hooksEngine: HooksEngine;

  abstract init(
    chainId: ChainId,
    executor: IExecutor,
    context: OrderProcessorInitContext
  ): Promise<void>;
  abstract process(params: IncomingOrderContext): Promise<void>;

  protected async waitIsOrderFulfilled(
    orderId: string,
    order: OrderData,
    context: OrderProcessorContext,
    logger: Logger
  ) {
    if (order.take.chainId === ChainId.Solana) {
      let state = await context.config.client.getTakeOrderState(
        {
          orderId,
          takeChain: order.take.chainId,
        },
        {}
      );
      const limit = 10;
      let iteration = 0;
      while (state === null || state.status !== OrderState.Fulfilled) {
        if (iteration === limit)
          throw new Error(
            "Failed to wait for order fulfillment, retries limit reached"
          );
        state = await context.config.client.getTakeOrderState(
          {
            orderId,
            takeChain: order.take.chainId,
          },
          {}
        );
        logger.debug(`state=${JSON.stringify(state)}`);
        await helpers.sleep(2000);
        iteration += 1;
      }
    }
  }
}
