import { Logger } from "pino";

import { Hook } from "./HookEnums";
import { HookParams } from "./HookParams";

export type HookContext = {
  logger: Logger;
};

export type HookHandler<T extends Hook> = (
  args: HookParams<T>,
  logger?: HookContext
) => Promise<void>;
