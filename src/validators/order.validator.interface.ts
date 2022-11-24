import { ChainId, OrderData } from "@debridge-finance/dln-client";

import {ExecutorConfig} from "../config";
import {ValidatorContext} from "./order.validator";

export abstract class OrderValidatorInterface {
  protected chainId: ChainId;

  abstract validate(order: OrderData,
           config: ExecutorConfig,
           context: ValidatorContext): Promise<boolean>

  abstract init(chainId: ChainId): Promise<void>;
}
