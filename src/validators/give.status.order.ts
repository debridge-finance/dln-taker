import { ChainId, Order, OrderData, OrderState } from "@debridge-finance/dln-client";
import { ExecutorConfig } from "../config";
import { ValidatorContext } from "./order.validator";
import { OrderValidatorInterface } from "./order.validator.interface";
import Web3 from "web3";

export class GiveStatusOrder extends OrderValidatorInterface {

  constructor() {
    super();
  }

  async validate(order: OrderData, config: ExecutorConfig, context: ValidatorContext): Promise<boolean> {
    const logger = context.logger.child({ validator: "GiveStatusOrder" });
    const calculatedOrderId = Order.calculateId(order);
    if (calculatedOrderId !== context.orderId) {
      logger.info(`approve status: false, calculatedOrderId: ${calculatedOrderId} orderId from feed: ${context.orderId}`);
      return Promise.resolve(false);
    }
    const chainId = order.give.chainId;
    const giveOrderStatus = await context.client.getGiveOrderStatus(calculatedOrderId, chainId, { web3: context.providers.get(chainId)!.connection as Web3 });
    const result = giveOrderStatus?.status === OrderState.Created;
    logger.info(`approve status: ${result}, giveOrderStatus: ${giveOrderStatus}`);
    return Promise.resolve(result);
  }

  init(chainId: ChainId): Promise<void> {
    return Promise.resolve(undefined);
  }
}

export function giveStatusOrder() {
  return new GiveStatusOrder()
}
