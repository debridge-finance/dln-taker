import { Logger } from "pino";

import { Hook } from "./HookEnums";
import { HookHandler } from "./HookHandler";
import { HookParams } from "./HookParams";

export class HooksEngine {
  constructor(
    private readonly hookHandlers: {
      [key in Hook]?: HookHandler<key>[];
    },
    private readonly logger: Logger,
  ) {}

  handleOrderFeedConnected(params: HookParams<Hook.OrderFeedConnected>) {
    this.process(Hook.OrderFeedConnected, params);
  }

  handleOrderFeedDisconnected() {
    this.process(Hook.OrderFeedDisconnected, {});
  }

  handleOrderRejected(params: HookParams<Hook.OrderRejected>) {
    this.process(Hook.OrderRejected, params);
  }

  handleOrderEstimated(params: HookParams<Hook.OrderEstimated>) {
    this.process(Hook.OrderEstimated, params);
  }

  handleOrderPostponed(params: HookParams<Hook.OrderPostponed>) {
    this.process(Hook.OrderPostponed, params);
  }

  handleOrderFulfilled(params: HookParams<Hook.OrderFulfilled>) {
    this.process(Hook.OrderFulfilled, params);
  }

  handleOrderUnlockSent(params: HookParams<Hook.OrderUnlockSent>) {
    this.process(Hook.OrderUnlockSent, params);
  }

  handleOrderUnlockFailed(params: HookParams<Hook.OrderUnlockFailed>) {
    this.process(Hook.OrderUnlockFailed, params);
  }

  private async process<T extends Hook>(
    hook: Hook,
    params: HookParams<T>
  ): Promise<void> {
    const handlers = this.hookHandlers[hook];
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        // @ts-ignore
        await handler(params, { logger: this.logger });
      } catch (e) {
        this.logger.error(`an error occurred while invoking handler for the ${Hook[hook]} hook: ${e}`);
        this.logger.error(e);
      }
    }
  }
}
