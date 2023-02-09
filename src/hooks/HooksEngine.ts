import { Logger } from "pino";

import { Hook } from "./hooks/Hook";
import { HooksEnum } from "./HooksEnum";
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
      [key in HooksEnum]?: Hook<HookParams>[];
    },
    private readonly logger: Logger
  ) {}

  handleOrderFeedConnected(params: OrderFeedConnectedParams) {
    this.process(HooksEnum.OrderFeedConnected, {});
  }

  handleOrderFeedDisconnected() {
    this.process(HooksEnum.OrderFeedDisconnected, {});
  }

  handleOrderRejected(params: OrderRejectedParams) {
    this.process(HooksEnum.OrderRejected, params);
  }

  handleOrderEstimated(params: OrderEstimatedParams) {
    this.process(HooksEnum.OrderEstimated, params);
  }

  handleOrderPostponed(params: OrderPostponedParams) {
    this.process(HooksEnum.OrderPostponed, params);
  }

  handleOrderFulfilled(params: OrderFulfilledParams) {
    this.process(HooksEnum.OrderFulfilled, params);
  }

  handleOrderUnlockSent(params: OrderUnlockSentParams) {
    this.process(HooksEnum.OrderUnlockSent, params);
  }

  handleOrderUnlockFailed(params: OrderUnlockFailedParams) {
    this.process(HooksEnum.OrderUnlockFailed, params);
  }

  private async process(
    hookEnum: HooksEnum,
    params: HookParams
  ): Promise<void> {
    const handlers = this.hookHandlers[hookEnum]!;
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        await handler.execute(params);
      } catch (e) {
        this.logger.error(`Error in execution hook handler in ${hookEnum}`);
        this.logger.error(e);
      }
    }
  }
}
