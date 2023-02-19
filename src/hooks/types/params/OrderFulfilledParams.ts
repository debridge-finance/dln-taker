import { IncomingOrder } from "../../../interfaces";
import { Hooks } from "../../Hooks";

import { HookParams } from "./HookParams";

export class OrderFulfilledParams extends HookParams<Hooks.OrderFulfilled> {
  order: IncomingOrder;
  txHash: string;
}
