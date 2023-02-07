import { ChainId } from "@debridge-finance/dln-client";
import { HookParams } from "./HookParams";

export class OrderUnlockFailedParams extends HookParams {
  orderIds: string[];
  fromChainId: ChainId;
  toChainId: ChainId;
  reason: "FAILED" | "REVERTED";
  message: string;
}
