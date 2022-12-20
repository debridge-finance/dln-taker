import { helpers } from "@debridge-finance/solana-utils";
import client, { Connection as MQConnection } from "amqplib";

import { OrderInfoStatus } from "../enums/order.info.status";
import { eventToOrderData, timeDiff, U256 } from "../helpers";
import { ExecuteNextOrder, GetNextOrder, NextOrderInfo } from "../interfaces";
import { PmmEvent } from "../pmm_common";

type RabbitMqConfig = {
  RABBIT_URL: string;

  QUEUE_NAME: string;
};

export class RabbitNextOrder extends GetNextOrder {
  private mqConnection: MQConnection;
  private initialized: boolean;

  constructor(
    private readonly config: RabbitMqConfig,
    private readonly eventTimeout: number
  ) {
    super();
    this.initialized = false;
  }

  async init(process: ExecuteNextOrder) {
    this.processNextOrder = process;
    this.mqConnection = await client.connect(this.config.RABBIT_URL);
    const channel = await this.mqConnection.createChannel();
    await channel.assertQueue(this.config.QUEUE_NAME, {
      durable: true,
      deadLetterExchange: "mm-dlx",
    });
    await channel.consume(this.config.QUEUE_NAME, (msg) => {
      if (msg) {
        const nextOrder = this.transform(msg);
        this.processNextOrder(nextOrder);
      }
    });
    this.initialized = true;
  }

  transform(message: client.ConsumeMessage): NextOrderInfo | undefined {
    const decoded = PmmEvent.fromBinary(message.content);
    switch (decoded.event.oneofKind) {
      case "createdSrc": {
        const orderData = eventToOrderData(
          decoded.event.createdSrc.createdOrder!
        );
        this.logger.debug(
          timeDiff(
            Number(decoded.transactionMetadata?.trackedByReaderTimestamp!)
          )
        );
        this.logger.debug(
          `${this.enabledChains}, ${orderData.take.chainId}, ${orderData.give.chainId}`
        );
        if (
          !this.enabledChains.includes(orderData.take.chainId) ||
          !this.enabledChains.includes(orderData.give.chainId) ||
          timeDiff(
            Number(decoded.transactionMetadata?.trackedByReaderTimestamp!)
          ) > this.eventTimeout
        )
          this.logger.debug(orderData);
        return {
          type: OrderInfoStatus.created,
          orderId: helpers.bufferToHex(
            U256.toBytesBE(decoded.event.createdSrc.orderId!)
          ),
          order: orderData,
        };
      }
      case "claimedOrderCancelSrc": {
        return {
          type: OrderInfoStatus.other,
          orderId: helpers.bufferToHex(
            U256.toBytesBE(decoded.event.claimedOrderCancelSrc.orderId!)
          ),
          order: null,
        };
      }
      case "claimedUnlockSrc": {
        return {
          type: OrderInfoStatus.other,
          orderId: helpers.bufferToHex(
            U256.toBytesBE(decoded.event.claimedUnlockSrc.orderId!)
          ),
          order: null,
        };
      }
      case "fulfilledDst": {
        return {
          type: OrderInfoStatus.fulfilled,
          orderId: helpers.bufferToHex(
            U256.toBytesBE(decoded.event.fulfilledDst.orderId!)
          ),
          order: eventToOrderData(decoded.event.fulfilledDst.fulfilledOrder!),
          taker: helpers.bufferToHex(
            Buffer.from(decoded.event.fulfilledDst.takerDst?.address!)
          ),
        };
      }
      case "orderCancelledDst": {
        return {
          type: OrderInfoStatus.cancelled,
          orderId: helpers.bufferToHex(
            U256.toBytesBE(decoded.event.orderCancelledDst.orderId!)
          ),
          order: null,
        };
      }
      case "sendOrderCancelDst": {
        return {
          type: OrderInfoStatus.other,
          orderId: helpers.bufferToHex(
            U256.toBytesBE(decoded.event.sendOrderCancelDst.orderId!)
          ),
          order: null,
        };
      }
      case "sendUnlockDst": {
        return {
          type: OrderInfoStatus.other,
          orderId: helpers.bufferToHex(
            U256.toBytesBE(decoded.event.sendUnlockDst.orderId!)
          ),
          order: null,
        };
      }
    }
  }
}
