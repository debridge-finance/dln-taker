export enum PostponingReasonEnum {
  NOT_ENOUGH_BALANCE, // indicates that taker’s reserve account has not enough funds to fulfill the order
  NON_PROFITABLE, // indicates that the current order is not profitable at the time of estimation
  ESTIMATION_FAILED, // indicates that the estimation was not succeeded, possibly because of third-party service unavailability (e.g., 1inch.io aggregator is unavailable)
  FULFILLMENT_FAILED, // indicates the inability to ensure the inclusion of the txn into the blockchain (e.g., we were unable to get the txn hash in the reasonable amount of time, or the RPC node is unavailable)
  FULFILLMENT_REVERTED, // indicates the txn to fulfill the order has been reverted for a reason
}
