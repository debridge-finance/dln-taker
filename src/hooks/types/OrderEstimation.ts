export type OrderEstimation = {
    isProfitable: boolean; // CalculateResult.isProfitable
    reserveToken: Uint8Array; // CalculateResult.reserveDstToken
    requiredReserveAmount: string; // CalculateResult.requiredReserveDstAmount
    fulfillToken: Uint8Array; // order.take.tokenAddress
    projectedFulfillAmount: string; // CalculateResult.profitableTakeAmount
};