import { ChainId } from "@debridge-finance/dln-client";

import { Hooks } from "../../Hooks";

import { HookParams } from "./HookParams";

export class OrderUnlockFailedParams extends HookParams<Hooks.OrderUnlockFailed> {
  orderIds: string[];
  fromChainId: ChainId;
  toChainId: ChainId;
  reason: "FAILED" | "REVERTED";
  message: string;
}
