import { ChainId, OrderState } from "@debridge-finance/dln-client";
import axios from "axios";
import { FilterOrderResponse, Order } from "./dto/FilterOrderResponse";

export class StatsAPI {
  private static readonly domain = 'https://dln-api.debridge.finance';
  private static readonly takeOrderCount: number = 100;

  async getOrders(giveChainIds: ChainId[], orderStates: OrderState[], unlockAuthorities: string): Promise<Order[]> {
    const orders: Order[] = [];

    let totalCount: number | undefined = undefined;
    let skip = 0;
    do {
      const { data } = await axios.post(StatsAPI.domain + '/api/Orders/filteredList', {
        giveChainIds,
        orderStates,
        unlockAuthorities,
        take: StatsAPI.takeOrderCount,
        skip,
      });
      skip += StatsAPI.takeOrderCount;
      const filterOrderResponse = data as FilterOrderResponse;
      if (totalCount === undefined) {
        totalCount = filterOrderResponse.totalCount;
      }
      orders.push(...filterOrderResponse.orders);
    } while (orders.length < totalCount);

    return orders;
  }
}