import { Offer, Order, OrderData } from "@debridge-finance/pmm-client";
import { helpers } from "@debridge-finance/solana-utils";
import WebSocket from "ws";

import { U256 } from "../helpers";
import { GetNextOrder, NextOrderInfo } from "../interfaces";

type WsOrderOffer = {
  chain_id: string;
  token_address: string;
  amount: string;
};

type WsOrder = {
  maker_order_nonce: string;
  maker_src: string;
  give: WsOrderOffer;
  take: WsOrderOffer;
  receiver_dst: string;
  give_patch_authority_src: string;
  order_authority_address_dst: string;
  allowed_taker_dst: string | null;
  allowed_cancel_beneficiary_src: string | null;
  external_call: null;
};

type FulfilledChangeStatus = { Fulfilled: { taker: number[] } };

type OrderChangeStatusInternal =
  | "Created"
  | FulfilledChangeStatus
  | "Cancelled"
  | "Patched";

type OrderChangeStatus = "Created" | "Fulfilled" | "Cancelled" | "Patched";

type WsOrderInfo = {
  order_id: string;
  order: WsOrder;
  order_info_status: OrderChangeStatusInternal;
};

type WsOrderEvent = {
  Order: {
    subscription_id: string;
    order_info: WsOrderInfo;
  };
};

export class WsNextOrder extends GetNextOrder {
  constructor(private wsUrl: string) {
    super();
  }

  async getNextOrder(): Promise<NextOrderInfo | undefined> {
    while (this.queue.length > 0) {
      const orderInfo = this.queue.shift()!;
      if (
        !this.enabledChains.includes(orderInfo.order.take.chainId) ||
        !this.enabledChains.includes(orderInfo.order.give.chainId)
      )
        continue;
      switch (orderInfo.state) {
        case "Created":
          return {
            order: orderInfo.order,
            type: "created",
            orderId: orderInfo.orderId,
          };
        case "Fulfilled":
          return {
            order: orderInfo.order,
            type: "fulfilled",
            orderId: orderInfo.orderId,
            taker: orderInfo.taker,
          };
        default:
          return {
            order: orderInfo.order,
            type: "other",
            orderId: orderInfo.orderId,
          };
      }
    }
  }

  init(): void {
    this.socket = new WebSocket(this.wsUrl);
    this.queue = [];
    this.socket.on("open", () => {
      this.socket.send(JSON.stringify({ Subcription: {} }));
    });
    this.socket.on("message", (event: Buffer) => {
      const data = JSON.parse(event.toString("utf-8"));
      this.logger.debug(data);
      if ("Order" in data) {
        const parsedEvent = data as WsOrderEvent;
        this.logger.debug(parsedEvent.Order.order_info);
        const order = this.wsOrderToOrderData(parsedEvent.Order.order_info);
        const [status, taker] = this.flattenStatus(
          parsedEvent.Order.order_info
        );
        this.queue.push({
          order,
          orderId: parsedEvent.Order.order_info.order_id,
          state: status,
          taker,
        });
      }
    });
  }

  private socket: WebSocket;
  private queue: {
    order: OrderData;
    orderId: string;
    state: OrderChangeStatus;
    taker?: string;
  }[];

  private wsOfferToOffer(info: WsOrderOffer): Offer {
    return {
      amount: U256.fromBytesBE(helpers.hexToBuffer(info.amount)).toBigInt(),
      chainId: Number(U256.fromHexBEString(info.chain_id).toBigInt()),
      tokenAddress: helpers.hexToBuffer(info.token_address),
    };
  }

  private wsOrderToOrderData(info: WsOrderInfo): OrderData {
    const order: OrderData = {
      nonce: BigInt(info.order.maker_order_nonce),
      give: this.wsOfferToOffer(info.order.give),
      take: this.wsOfferToOffer(info.order.take),
      givePatchAuthority: helpers.hexToBuffer(
        info.order.give_patch_authority_src
      ),
      maker: helpers.hexToBuffer(info.order.maker_src),
      orderAuthorityDstAddress: helpers.hexToBuffer(
        info.order.order_authority_address_dst
      ),
      receiver: helpers.hexToBuffer(info.order.receiver_dst),
      allowedCancelBeneficiary: info.order.allowed_cancel_beneficiary_src
        ? helpers.hexToBuffer(info.order.allowed_cancel_beneficiary_src)
        : undefined,
      allowedTaker: info.order.allowed_taker_dst
        ? helpers.hexToBuffer(info.order.allowed_taker_dst)
        : undefined,
      externalCall: undefined,
    };
    const calculatedId = Order.calculateId(order);
    if (calculatedId != info.order_id)
      throw new Error(
        `OrderId mismatch!\nProbably error during conversions between formats\nexpected id: ${info.order_id}\ncalculated: ${calculatedId}\nReceived order: ${info.order}\nTransformed: ${order}`
      );
    return order;
  }

  private flattenStatus(
    info: WsOrderInfo
  ): [OrderChangeStatus, string | undefined] {
    const status = info.order_info_status;
    if (Object.prototype.hasOwnProperty.call(status, "Fulfilled"))
      return [
        "Fulfilled",
        helpers.bufferToHex(
          Buffer.from((status as FulfilledChangeStatus).Fulfilled.taker)
        ),
      ];
    return [
      status as Exclude<OrderChangeStatusInternal, FulfilledChangeStatus>,
      undefined,
    ];
  }
}
