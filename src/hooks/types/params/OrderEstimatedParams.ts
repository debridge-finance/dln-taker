
import { IncomingOrder } from "../../../interfaces";
import { OrderProcessorContext } from "../../../processors/base";
import { OrderEstimation } from "../OrderEstimation";

import { HookParams } from "./HookParams";

export class OrderEstimatedParams extends HookParams {
  order: IncomingOrder;
  isLive: boolean;
  estimation: OrderEstimation;
  context: OrderProcessorContext;
}
