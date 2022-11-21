import {OrderData} from "@debridge-finance/pmm-client/src/order";
import {ExecutorConfig} from "../config";
import {ValidatorContext} from "./order.validator";
import {ChainId} from "@debridge-finance/pmm-client";

export abstract class OrderValidatorInterface {
  protected chainId: ChainId;

  abstract validate(order: OrderData,
           config: ExecutorConfig,
           context: ValidatorContext): Promise<boolean>

  abstract init(chainId: ChainId): Promise<void>;
}
