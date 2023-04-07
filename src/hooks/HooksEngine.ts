import { Logger } from "pino";

import { Hooks } from "./HookEnums";
import { HookHandler } from "./HookHandler";
import { HookParams } from "./types/HookParams";

export class HooksEngine {
    constructor(
        private readonly hookHandlers: {
            [key in Hooks]?: HookHandler<key>[];
        },
        private readonly logger: Logger,
    ) {}

    handleOrderFeedConnected(params: HookParams<Hooks.OrderFeedConnected>) {
        this.process(Hooks.OrderFeedConnected, params);
    }

    handleOrderFeedDisconnected(params: HookParams<Hooks.OrderFeedDisconnected>) {
        this.process(Hooks.OrderFeedDisconnected, params);
    }

    handleOrderRejected(params: HookParams<Hooks.OrderRejected>) {
        this.process(Hooks.OrderRejected, params);
    }

    handleOrderEstimated(params: HookParams<Hooks.OrderEstimated>) {
        this.process(Hooks.OrderEstimated, params);
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

    private async process<T extends Hooks>(
        hookEnum: Hooks,
        params: HookParams<T>
    ): Promise<void> {
        const handlers = this.hookHandlers[hookEnum];
        if (!handlers) return;
        for (const handler of handlers) {
            try {
                // @ts-ignore
                await handler(params, { logger: this.logger });
            } catch (e) {
                this.logger.error(`Error in execution hook handler in ${hookEnum}`);
                this.logger.error(e);
            }
        }
    }
}