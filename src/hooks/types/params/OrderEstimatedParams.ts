import { IncomingOrder } from "../../../interfaces";
import { OrderProcessorContext } from "../../../processors/base";
import { Hooks } from "../../Hooks";
import { OrderEstimation } from "../OrderEstimation";

import { HookParams } from "./HookParams";

export class OrderEstimatedParams extends HookParams<Hooks.OrderEstimated> {
  order: IncomingOrder;
  isLive: boolean;
  estimation: OrderEstimation;
  context: OrderProcessorContext;
}
