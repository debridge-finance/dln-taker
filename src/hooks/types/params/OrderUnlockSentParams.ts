import { ChainId } from "@debridge-finance/dln-client";

import { Hooks } from "../../Hooks";

import { HookParams } from "./HookParams";

export class OrderUnlockSentParams extends HookParams<Hooks.OrderUnlockSent> {
  orderIds: string[];
  fromChainId: ChainId;
  toChainId: ChainId;
  txHash: string;
}
