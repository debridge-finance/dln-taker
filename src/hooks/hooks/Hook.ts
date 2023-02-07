import { HookParams } from "../types/params/HookParams";

export abstract class Hook<T extends HookParams> {
  abstract execute(arg: T): Promise<void>;
}
