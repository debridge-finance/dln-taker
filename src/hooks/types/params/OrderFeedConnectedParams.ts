import { Hooks } from "../../Hooks";

import { HookParams } from "./HookParams";

export class OrderFeedConnectedParams extends HookParams<Hooks.OrderFeedConnected> {
  timeSinceLastDisconnect?: number;
}
