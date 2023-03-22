import { Logger } from "pino";

import { Hooks } from "./HookEnums";
import { HookParams } from "./types/HookParams";

export type HookContext = {
  logger: Logger;
};

export type HookHandler<T extends Hooks> = (
  args: HookParams<T>,
  logger?: HookContext
) => Promise<void>;
