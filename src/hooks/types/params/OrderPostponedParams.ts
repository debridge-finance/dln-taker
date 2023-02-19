import { IncomingOrder } from "../../../interfaces";
import { OrderProcessorContext } from "../../../processors/base";
import { PostponingReason } from "../../HookEnums";
import { Hooks } from "../../Hooks";
import { OrderEstimation } from "../OrderEstimation";

import { HookParams } from "./HookParams";

export class OrderPostponedParams extends HookParams<Hooks.OrderPostponed> {
  order: IncomingOrder;
  isLive: boolean;
  reason: PostponingReason;
  message?: string;
  estimation?: OrderEstimation;
  context: OrderProcessorContext;
}
