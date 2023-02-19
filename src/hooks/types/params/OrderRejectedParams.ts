import { IncomingOrder } from "../../../interfaces";
import { OrderProcessorContext } from "../../../processors/base";
import { RejectionReason } from "../../HookEnums";
import { Hooks } from "../../Hooks";

import { HookParams } from "./HookParams";

export class OrderRejectedParams extends HookParams<Hooks.OrderRejected> {
  order: IncomingOrder;
  isLive: boolean;
  reason: RejectionReason;
  context: OrderProcessorContext;
}
