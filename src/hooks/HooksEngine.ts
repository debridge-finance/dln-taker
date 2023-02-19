import { Logger } from "pino";

import { Hooks } from "./Hooks";
import { HookHandler } from "./hooks/HookHandler";
import { HookParams } from "./types/params/HookParams";
import { OrderEstimatedParams } from "./types/params/OrderEstimatedParams";
import { OrderFeedConnectedParams } from "./types/params/OrderFeedConnectedParams";
import { OrderFulfilledParams } from "./types/params/OrderFulfilledParams";
import { OrderPostponedParams } from "./types/params/OrderPostponedParams";
import { OrderRejectedParams } from "./types/params/OrderRejectedParams";
import { OrderUnlockFailedParams } from "./types/params/OrderUnlockFailedParams";
import { OrderUnlockSentParams } from "./types/params/OrderUnlockSentParams";

export class HooksEngine {
  constructor(
    private readonly hookHandlers: {
      [key in Hooks]?: HookHandler<key>[];
    },
    private readonly logger: Logger
  ) {}

  handleOrderFeedConnected(params: OrderFeedConnectedParams) {
    this.process(Hooks.OrderFeedConnected, params);
  }

  handleOrderFeedDisconnected() {
    this.process(Hooks.OrderFeedDisconnected, {});
  }

  handleOrderRejected(params: OrderRejectedParams) {
    this.process(Hooks.OrderRejected, params);
  }

  handleOrderEstimated(params: OrderEstimatedParams) {
    this.process(Hooks.OrderEstimated, params);
  }

  handleOrderPostponed(params: OrderPostponedParams) {
    this.process(Hooks.OrderPostponed, params);
  }

  handleOrderFulfilled(params: OrderFulfilledParams) {
    this.process(Hooks.OrderFulfilled, params);
  }

  handleOrderUnlockSent(params: OrderUnlockSentParams) {
    this.process(Hooks.OrderUnlockSent, params);
  }

  handleOrderUnlockFailed(params: OrderUnlockFailedParams) {
    this.process(Hooks.OrderUnlockFailed, params);
  }

  private async process<T extends Hooks>(
    hookEnum: Hooks,
    params: HookParams<T>
  ): Promise<void> {
    const handlers = this.hookHandlers[hookEnum]!;
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        await handler(params, { logger: this.logger });
      } catch (e) {
        this.logger.error(`Error in execution hook handler in ${hookEnum}`);
        this.logger.error(e);
      }
    }
  }
}
