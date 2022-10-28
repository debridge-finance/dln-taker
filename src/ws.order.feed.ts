import { GetNextOrder, NextOrderInfo } from "./interfaces";
import "sockette";

class WsNextOrder implements GetNextOrder {
    constructor(wsUrl: string) {
    }

    async getNextOrder(): Promise<NextOrderInfo> {

    }
}