import { IncomingOrder } from "../../../interfaces";
import { RejectionReasonEnum } from "../../RejectionReasonEnum";
import { HookParams } from "./HookParams";

export class OrderRejectedParams extends HookParams {
  order: IncomingOrder;
  isLive: boolean;
  reason: RejectionReasonEnum;
}
