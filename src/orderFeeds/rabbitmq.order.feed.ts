import { helpers } from "@debridge-finance/solana-utils";
import { eventToOrderData, timeDiff, U256 } from "../helpers";
import { Config, GetNextOrder, NextOrderInfo } from "../interfaces";
import { PmmEvent } from "../pmm_common";
import client, { Connection as MQConnection } from "amqplib";
import { ChainId } from "@debridge-finance/pmm-client";

type RabbitMqConfig = {
    RABBIT_URL: string;

    QUEUE_NAME: string;
};

export class RabbitNextOrder extends GetNextOrder {
    private queue: client.ConsumeMessage[] = [];
    private mqConnection: MQConnection;
    private initialized: boolean;

    constructor(private readonly config: RabbitMqConfig, private readonly eventTimeout: number) {
        super();
        this.initialized = false;
    }

    async init() {
        this.mqConnection = await client.connect(this.config.RABBIT_URL);
        const channel = await this.mqConnection.createChannel();
        await channel.assertQueue(this.config.QUEUE_NAME, { durable: true, deadLetterExchange: "mm-dlx" });
        await channel.consume(this.config.QUEUE_NAME, (msg) => {
            if (msg) {
                this.queue.push(msg);
            }
        });
        this.initialized = true;
    }

    async getNextOrder(): Promise<NextOrderInfo | undefined> {
        if (!this.initialized) await this.init();
        while (this.queue.length != 0) {
            const firstIn = this.queue.shift();
            const decoded = PmmEvent.fromBinary(firstIn!.content);
            switch (decoded.event.oneofKind) {
                case "createdSrc": {
                    const orderData = eventToOrderData(decoded.event.createdSrc.createdOrder!);
                    console.log(timeDiff(Number(decoded.transactionMetadata?.trackedByReaderTimestamp!)));
                    console.log(this.enabledChains, orderData.take.chainId, orderData.give.chainId);
                    if (
                      !this.enabledChains.includes(orderData.take.chainId) ||
                      !this.enabledChains.includes(orderData.give.chainId) ||
                      timeDiff(Number(decoded.transactionMetadata?.trackedByReaderTimestamp!)) > this.eventTimeout
                    ) continue;
                    console.log(orderData);
                    return {
                        type: "created",
                        orderId: helpers.bufferToHex(U256.toBytesBE(decoded.event.createdSrc.orderId!)),
                        order: orderData,
                    }
                }
                case "claimedOrderCancelSrc": {
                    return {
                        type: "other",
                        orderId: helpers.bufferToHex(U256.toBytesBE(decoded.event.claimedOrderCancelSrc.orderId!)),
                        order: null,
                    }
                }
                case "claimedUnlockSrc": {
                    return {
                        type: "other",
                        orderId: helpers.bufferToHex(U256.toBytesBE(decoded.event.claimedUnlockSrc.orderId!)),
                        order: null,
                    }
                }
                case "fulfilledDst": {
                    return {
                        type: "fulfilled",
                        orderId: helpers.bufferToHex(U256.toBytesBE(decoded.event.fulfilledDst.orderId!)),
                        order: eventToOrderData(decoded.event.fulfilledDst.fulfilledOrder!),
                        taker: helpers.bufferToHex(Buffer.from(decoded.event.fulfilledDst.takerDst?.address!)),
                    }
                }
                case "orderCancelledDst": {
                    return {
                        type: "other",
                        orderId: helpers.bufferToHex(U256.toBytesBE(decoded.event.orderCancelledDst.orderId!)),
                        order: null,
                    }
                }
                case "sendOrderCancelDst": {
                    return {
                        type: "other",
                        orderId: helpers.bufferToHex(U256.toBytesBE(decoded.event.sendOrderCancelDst.orderId!)),
                        order: null,
                    }
                }
                case "sendUnlockDst": {
                    return {
                        type: "other",
                        orderId: helpers.bufferToHex(U256.toBytesBE(decoded.event.sendUnlockDst.orderId!)),
                        order: null,
                    }
                }
            }
        }
    }
}
