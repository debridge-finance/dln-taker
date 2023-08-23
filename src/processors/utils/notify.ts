
import { ChainId, OrderData, tokenAddressToString } from "@debridge-finance/dln-client";
import axios from "axios";

export async function tgNotify(text: string): Promise<any> {
  return axios.post(
    `https://api.telegram.org/bot${process.env.TG_BOT}/sendMessage`,
    {
      chat_id: process.env.TG_CHAT,
      text
    }
  )
}

export async function tgNotifyOrder(id: string, order: OrderData, text: string): Promise<any> {
  return tgNotify(`order ${id} (${ChainId[order.give.chainId]} -> ${ChainId[order.take.chainId]}, receiver ${tokenAddressToString(order.take.chainId, order.receiver)}) ${text}`)
}