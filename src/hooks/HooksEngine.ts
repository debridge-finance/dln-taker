import { Logger } from 'pino';

import { Hooks } from './HookEnums';
import { HookHandler } from './HookHandler';
import { HookParams } from './types/HookParams';

export class HooksEngine {
  readonly #logger: Logger;

  constructor(
    private readonly hookHandlers: {
      [key in Hooks]?: HookHandler<key>[];
    },
    logger: Logger,
  ) {
    this.#logger = logger.child({
      service: HooksEngine.name,
    });
  }

  handleOrderFeedConnected(params: HookParams<Hooks.OrderFeedConnected>) {
    this.process(Hooks.OrderFeedConnected, params);
  }

  handleOrderFeedDisconnected(params: HookParams<Hooks.OrderFeedDisconnected>) {
    this.process(Hooks.OrderFeedDisconnected, params);
  }

  handleOrderRejected(params: HookParams<Hooks.OrderRejected>) {
    this.process(Hooks.OrderRejected, params);
  }

  handleOrderPostponed(params: HookParams<Hooks.OrderPostponed>) {
    this.process(Hooks.OrderPostponed, params);
  }

  handleOrderFulfilled(params: HookParams<Hooks.OrderFulfilled>) {
    this.process(Hooks.OrderFulfilled, params);
  }

  handleOrderUnlockSent(params: HookParams<Hooks.OrderUnlockSent>) {
    this.process(Hooks.OrderUnlockSent, params);
  }

  handleOrderUnlockFailed(params: HookParams<Hooks.OrderUnlockFailed>) {
    this.process(Hooks.OrderUnlockFailed, params);
  }

  private async process<T extends Hooks>(hookEnum: Hooks, params: HookParams<T>): Promise<void> {
    this.#logger.debug(`triggering hook ${Hooks[hookEnum]}`);
    const handlers = this.hookHandlers[hookEnum] || [];
    for (const handler of handlers) {
      try {
        // eslint-disable-next-line no-await-in-loop -- Used to track hook errors. TODO make hooks asynchronous DEV-3490
        await handler(params as any, { logger: this.#logger.child({ hook: Hooks[hookEnum] }) });
      } catch (e) {
        this.#logger.error(`Error in execution hook handler in ${hookEnum}`);
        this.#logger.error(e);
      }
    }
  }
}
