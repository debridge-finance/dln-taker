import { ChainId, Order, OrderData, OrderState } from "@debridge-finance/dln-client";
import { ExecutorConfig } from "../config";
import { ValidatorContext } from "./order.validator";
import { OrderValidatorInterface } from "./order.validator.interface";
import Web3 from "web3";
import { GiveOrderStatus } from "@debridge-finance/dln-client/dist/types/common.types";

class GiveOrderState extends OrderValidatorInterface {

  constructor() {
    super();
  }

  async validate(order: OrderData, config: ExecutorConfig, context: ValidatorContext): Promise<boolean> {
    const logger = context.logger.child({ validator: "GiveORderState" });
    const calculatedOrderId = Order.calculateId(order);
    if (calculatedOrderId !== context.orderId) {
      logger.info(`approve status: false, calculatedOrderId: ${calculatedOrderId} differs from the orderId received from the feed: ${context.orderId}`);
      return Promise.resolve(false);
    }
    const chainId = order.give.chainId;
    const giveOrderStatus = await this.getOrderStatus(order, context);
    const result = giveOrderStatus?.status === OrderState.Created;
    logger.info(`approve status: ${result}, giveOrderStatus: ${giveOrderStatus}`);
    return Promise.resolve(result);
  }

  init(chainId: ChainId): Promise<void> {
    return Promise.resolve(undefined);
  }

  private async getOrderStatus(order: OrderData, context: ValidatorContext) : Promise<GiveOrderStatus | null> {
    try {
      const status = await context.client.getGiveOrderStatus(context.orderId, order.give.chainId, { web3: context.providers.get(order.give.chainId)!.connection as Web3 })
      return status;
    }
    catch (e) {
      return null;
    }
  }
}

/**
 * Ensures the given order is presented on the source chain and is fulfillable
 */
export function giveOrderState() {
  return new GiveOrderState()
}
