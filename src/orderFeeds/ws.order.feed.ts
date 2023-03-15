import { ChainId, Offer, Order, OrderData } from "@debridge-finance/dln-client";
import { helpers } from "@debridge-finance/solana-utils";
import WebSocket from "ws";

import { U256 } from "../helpers";
import { HooksEngine } from "../hooks/HooksEngine";
import {
  GetNextOrder,
  IncomingOrder,
  OrderInfoStatus,
  OrderProcessorFunc,
  UnlockAuthority,
} from "../interfaces";

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

type FulfilledChangeStatus = { Fulfilled: { unlock_authority: string } };
type ArchivalFulfilledChangeStatus = {
  ArchivalFulfilled: { unlock_authority: string };
};
type ArchivalCreatedChangeStatus = { ArchivalCreated: {} };
type CreatedChangeStatus = {
  Created: {
    finalization_info:
      | {
          Finalized: {
            transaction_hash: string;
          };
        }
      | {
          Confirmed: {
            confirmation_blocks_count: number;
            transaction_hash: string;
          };
        }
      | "Revoked";
  };
};
type CancelledChangeStatus = { Cancelled: {} };

enum WsOrderInfoStatus {
  ArchivalCreated,
  Created,
  ArchivalFulfilled,
  Fulfilled,
  Cancelled,
  UnlockSent,
  UnlockClaim,
  TakeOfferDecreased,
  GiveOfferIncreased,
}

type WsOrderInfo<T extends WsOrderInfoStatus> = {
  order_id: string;
  order: WsOrder;
  order_info_status: {} & (T extends WsOrderInfoStatus.ArchivalCreated
    ? ArchivalCreatedChangeStatus
    : {}) &
    (T extends WsOrderInfoStatus.Created ? CreatedChangeStatus : {}) &
    (T extends WsOrderInfoStatus.ArchivalFulfilled
      ? ArchivalFulfilledChangeStatus
      : {}) &
    (T extends WsOrderInfoStatus.Fulfilled ? FulfilledChangeStatus : {}) &
    (T extends WsOrderInfoStatus.Cancelled ? CancelledChangeStatus : {});
};

type WsOrderEvent<T extends WsOrderInfoStatus> = {
  Order: {
    subscription_id: string;
    order_info: WsOrderInfo<T>;
  };
};

export class WsNextOrder extends GetNextOrder {
  private wsArgs;
  private socket: WebSocket;
  private readonly pingTimeoutMs = 3000;
  private pingTimer: NodeJS.Timeout;
  private unlockAuthorities: UnlockAuthority[];
  private minConfirmationThresholds: {
    chainId: ChainId;
    points: number[];
  }[];

  private hooksEngine: HooksEngine;
  private timeLastDisconnect: Date;

  private heartbeat() {
    clearTimeout(this.pingTimer);

    this.pingTimer = setTimeout(() => {
      this.logger.error(`WsConnection appears to be stale, reconnecting`);
      this.socket.terminate();
      this.initWs();
    }, this.pingTimeoutMs);
  }

  constructor(...args: ConstructorParameters<typeof WebSocket>) {
    super();
    this.wsArgs = args;
  }

  async init(
    process: OrderProcessorFunc,
    unlockAuthorities: UnlockAuthority[],
    minConfirmationThresholds: {
      chainId: ChainId;
      points: number[];
    }[],
    hooksEngine: HooksEngine
  ) {
    super.processNextOrder = process;
    this.unlockAuthorities = unlockAuthorities;
    this.minConfirmationThresholds = minConfirmationThresholds;
    this.hooksEngine = hooksEngine;
    await this.initWs();
  }

  private async initWs() {
    this.socket = new WebSocket(...this.wsArgs);
    this.socket.on("ping", this.heartbeat.bind(this));
    this.socket.on("open", () => {
      let timeSinceLastDisconnect;
      if (this.timeLastDisconnect) {
        timeSinceLastDisconnect =
          (new Date().getTime() - this.timeLastDisconnect.getTime()) / 1000;
      }
      this.hooksEngine.handleOrderFeedConnected({
        timeSinceLastDisconnect,
      });
      this.logger.debug("🔌 ws opened connection");
      this.heartbeat();

      // Subscribe to all new orders
      const confirmationsCountFilter: { [key in string]: number[] } =
        Object.fromEntries(
          this.minConfirmationThresholds.map((threshold) => [
            threshold.chainId.toString(16).padStart(64, "0"),
            threshold.points,
          ])
        );
      this.sendCommand({
        Subscription: {
          finalization_filter: {
            confirmations_count: confirmationsCountFilter,
          },
        },
      });

      // Get all existing new orders (for cold start)
      this.sendCommand({ GetOrders: { Created: {} } });

      // Get all fulfilled orders by the given unlockAuthority (for cold start - to initiate unlocks)
      this.unlockAuthorities.forEach((unlockAuthority) => {
        this.sendCommand({
          GetOrders: {
            Fulfilled: {
              unlock_authority: unlockAuthority.address,
              take_filter: {
                All: {
                  chain_id: unlockAuthority.chainId
                    .toString(16)
                    .padStart(64, "0"),
                },
              },
            },
          },
        });
      });
    });

    // Register message handler
    this.socket.on("message", (event: Buffer) => {
      const data = JSON.parse(event.toString("utf-8"));
      this.logger.info(`📨 ws received new message`);
      this.logger.debug(data);
      if ("Order" in data) {
        const parsedEvent = data as WsOrderEvent<any>;

        try {
          const status = this.flattenStatus(parsedEvent.Order.order_info);
          const order = this.wsOrderToOrderData(parsedEvent.Order.order_info);
          const orderId = parsedEvent.Order.order_info.order_id;
          const nextOrderInfo = this.transformToNextOrderInfo(
            status,
            orderId,
            order,
            parsedEvent
          );
          this.processNextOrder(nextOrderInfo);
        } catch (e) {
          this.logger.error(`message processing failed: ${e}`);
          this.logger.error(e);
        }
      }
    });

    this.socket.on("error", async (err) => {
      this.logger.error(`WsConnection received error: ${err.message}`);
    });

    this.socket.on("close", () => {
      this.hooksEngine.handleOrderFeedDisconnected();
      this.logger.debug(
        `WsConnection has been closed, retrying reconnection in ${this.pingTimeoutMs}ms`
      );
    });

    this.heartbeat();
  }

  private sendCommand(command: { [key in any]: any }) {
    this.logger.debug("command send to WS");
    this.logger.debug(command);
    this.socket.send(JSON.stringify(command));
  }

  private transformToNextOrderInfo(
    status: WsOrderInfoStatus,
    orderId: string,
    order: OrderData,
    event: WsOrderEvent<any>
  ): IncomingOrder<any> {
    switch (status) {
      case WsOrderInfoStatus.Created:
        const createdOrder: IncomingOrder<OrderInfoStatus.Created> = {
          orderId,
          order,
          status: OrderInfoStatus.Created,
          finalization_info: (event as WsOrderEvent<WsOrderInfoStatus.Created>)
            .Order.order_info.order_info_status.Created.finalization_info,
        };
        return createdOrder;
      case WsOrderInfoStatus.ArchivalCreated:
        const archivalCreatedOrder: IncomingOrder<OrderInfoStatus.ArchivalCreated> =
          {
            orderId,
            order,
            status: OrderInfoStatus.ArchivalCreated,
          };
        return archivalCreatedOrder;
      case WsOrderInfoStatus.ArchivalFulfilled:
        const archivalFulfilledOrder: IncomingOrder<OrderInfoStatus.ArchivalFulfilled> =
          {
            orderId,
            order,
            status: OrderInfoStatus.ArchivalFulfilled,
            unlockAuthority: (
              event as WsOrderEvent<WsOrderInfoStatus.ArchivalFulfilled>
            ).Order.order_info.order_info_status.ArchivalFulfilled
              .unlock_authority,
          };
        return archivalFulfilledOrder;
      case WsOrderInfoStatus.Fulfilled:
        const fulfilledOrder: IncomingOrder<OrderInfoStatus.Fulfilled> = {
          orderId,
          order,
          status: OrderInfoStatus.Fulfilled,
          unlockAuthority: (event as WsOrderEvent<WsOrderInfoStatus.Fulfilled>)
            .Order.order_info.order_info_status.Fulfilled.unlock_authority,
        };
        return fulfilledOrder;
      case WsOrderInfoStatus.Cancelled:
        const cancelledOrder: IncomingOrder<OrderInfoStatus.Cancelled> = {
          orderId,
          order,
          status: OrderInfoStatus.Cancelled,
        };
        return cancelledOrder;
      case WsOrderInfoStatus.UnlockSent:
        const unlockSent: IncomingOrder<OrderInfoStatus.UnlockSent> = {
          orderId,
          order,
          status: OrderInfoStatus.UnlockSent,
        };
        return unlockSent;
      case WsOrderInfoStatus.UnlockClaim:
        const UnlockClaim: IncomingOrder<OrderInfoStatus.UnlockClaim> = {
          orderId,
          order,
          status: OrderInfoStatus.UnlockClaim,
        };
        return UnlockClaim;
      case WsOrderInfoStatus.TakeOfferDecreased:
        const TakeOfferDecreased: IncomingOrder<OrderInfoStatus.TakeOfferDecreased> =
          {
            orderId,
            order,
            status: OrderInfoStatus.TakeOfferDecreased,
          };
        return TakeOfferDecreased;
      case WsOrderInfoStatus.GiveOfferIncreased:
        const GiveOfferIncreased: IncomingOrder<OrderInfoStatus.GiveOfferIncreased> =
          {
            orderId,
            order,
            status: OrderInfoStatus.GiveOfferIncreased,
          };
        return GiveOfferIncreased;
      default:
        throw new Error(
          `Unsupported order state: ${WsOrderInfoStatus[status]}`
        );
    }
  }

  private wsOfferToOffer(info: WsOrderOffer): Offer {
    return {
      amount: U256.fromBytesBE(helpers.hexToBuffer(info.amount)).toBigInt(),
      chainId: Number(U256.fromHexBEString(info.chain_id).toBigInt()),
      tokenAddress: helpers.hexToBuffer(info.token_address),
    };
  }

  private wsOrderToOrderData(info: WsOrderInfo<any>): OrderData {
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

  private flattenStatus(info: WsOrderInfo<any>): WsOrderInfoStatus {
    for (const orderInfoStatus in WsOrderInfoStatus) {
      // skip indicies (0, 1, 2, ...)
      if (!isNaN(Number(orderInfoStatus))) continue;

      if (orderInfoStatus in info.order_info_status) {
        return WsOrderInfoStatus[orderInfoStatus] as any as WsOrderInfoStatus;
      }
    }

    throw new Error("status not found");
  }
}
