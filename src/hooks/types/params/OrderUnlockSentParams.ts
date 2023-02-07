import { ChainId } from "@debridge-finance/dln-client";
import { HookParams } from "./HookParams";

export class OrderUnlockSentParams extends HookParams {
  orderIds: string[];
  fromChainId: ChainId;
  toChainId: ChainId;
  txHash: string;
}
