import { IncomingOrder } from "../../../interfaces";
import { HookParams } from "./HookParams";

export class OrderFulfilledParams extends HookParams {
  order: IncomingOrder;
  txHash: string;
}
