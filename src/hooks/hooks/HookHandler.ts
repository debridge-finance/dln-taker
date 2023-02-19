import { Logger } from "pino";

import { Hooks } from "../Hooks";
import { HookParams } from "../types/params/HookParams";

export type HookContext = {
  logger: Logger;
};

export type HookHandler<T extends Hooks> = (
  args: HookParams<T>,
  logger?: HookContext
) => Promise<void>;
