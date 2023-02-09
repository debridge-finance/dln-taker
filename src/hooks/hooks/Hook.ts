import { Logger } from "pino";

import { HookParams } from "../types/params/HookParams";

export type HookContext = {
  logger: Logger;
};

export abstract class Hook<T extends HookParams> {
  abstract execute(arg: T, context?: HookContext): Promise<void>;
}
