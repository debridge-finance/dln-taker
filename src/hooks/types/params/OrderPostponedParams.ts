import { IncomingOrder } from "../../../interfaces";
import { OrderProcessorContext } from "../../../processors/base";
import { PostponingReasonEnum } from "../../PostponingReasonEnum";
import { OrderEstimation } from "../OrderEstimation";
import { HookParams } from "./HookParams";

export class OrderPostponedParams extends HookParams {
  order: IncomingOrder;
  isLive: boolean;
  reason: PostponingReasonEnum;
  message: string;
  estimation?: OrderEstimation;
  context: OrderProcessorContext;
}
