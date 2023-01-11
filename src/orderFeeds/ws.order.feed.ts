import { Offer, Order, OrderData } from "@debridge-finance/dln-client";
import { helpers } from "@debridge-finance/solana-utils";
import WebSocket from "ws";

import { OrderInfoStatus } from "../enums/order.info.status";
import { U256 } from "../helpers";
import { GetNextOrder, IncomingOrder, OrderProcessorFunc } from "../interfaces";

type OrderInfo = {
  order: OrderData;
  orderId: string;
  state: OrderChangeStatus;
  taker?: string;
};

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
  | "GiveOfferIncreased"
  | "TakeOfferDecreased";

type OrderChangeStatus =
  | "Created"
  | "Archival"
  | "Fulfilled"
  | "Cancelled"
  | "GiveOfferIncreased"
  | "TakeOfferDecreased";

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
  private wsArgs;
  private socket: WebSocket;

  constructor(...args: ConstructorParameters<typeof WebSocket>) {
    super();
    this.wsArgs = args;
  }

  init(process: OrderProcessorFunc): void {
    super.processNextOrder = process;
    this.socket = new WebSocket(...this.wsArgs);
    this.socket.on("open", () => {
      this.logger.debug("🔌 ws opened connection");
      this.socket.send(
        JSON.stringify({
          Subscription: {
            live: true,
          },
        })
      );
      this.socket.send(JSON.stringify(
        {
          GetArchive: {},
        }
      ));
    });
    this.socket.on("message", (event: Buffer) => {
      const data = JSON.parse(event.toString("utf-8"));
      this.logger.debug("📨 ws received new message", data);
      if ("Order" in data) {
        const parsedEvent = data as WsOrderEvent;
        const order = this.wsOrderToOrderData(parsedEvent.Order.order_info);
        this.logger.debug("ws parsed order", order);

        const [status, taker] = this.flattenStatus(
          parsedEvent.Order.order_info
        );
        const nextOrderInfo = this.transformToNextOrderInfo({
          order,
          orderId: parsedEvent.Order.order_info.order_id,
          state: status,
          taker,
        });
        this.processNextOrder(nextOrderInfo);
      }
    });
  }

  private transformToNextOrderInfo(
    orderInfo: OrderInfo
  ): IncomingOrder | undefined {
    switch (orderInfo.state) {
      case "Created":
        return {
          order: orderInfo.order,
          type: OrderInfoStatus.created,
          orderId: orderInfo.orderId,
        };
      case "Archival":
        return {
          order: orderInfo.order,
          type: OrderInfoStatus.archival,
          orderId: orderInfo.orderId,
        };
      case "Fulfilled":
        return {
          order: orderInfo.order,
          type: OrderInfoStatus.fulfilled,
          orderId: orderInfo.orderId,
          taker: orderInfo.taker,
        };
      case "Cancelled":
        return {
          order: orderInfo.order,
          type: OrderInfoStatus.cancelled,
          orderId: orderInfo.orderId,
          taker: orderInfo.taker,
        };
      default:
        return {
          order: orderInfo.order,
          type: OrderInfoStatus.other,
          orderId: orderInfo.orderId,
        };
    }
  }

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
    if (calculatedId !== info.order_id)
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
