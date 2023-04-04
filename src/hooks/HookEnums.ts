export enum Hooks {
  OrderFeedConnected,
  OrderFeedDisconnected,
  OrderRejected,
  OrderEstimated,
  OrderPostponed,
  OrderFulfilled,
  OrderUnlockSent,
  OrderUnlockFailed,
}

export enum PostponingReason {
  /**
   * indicates that taker’s reserve account has not enough funds to fulfill the order
   */
  NOT_ENOUGH_BALANCE,

  /**
   * indicates that the current order is not profitable at the time of estimation
   */
  NON_PROFITABLE,

  /**
   * indicates that the estimation was not succeeded, possibly because of third-party service unavailability (e.g., 1inch.io aggregator is unavailable)
   */
  ESTIMATION_FAILED,

  /**
   * indicates the inability to ensure the inclusion of the txn into the blockchain (e.g., we were unable to get the txn hash in the reasonable amount of time, or the RPC node is unavailable)
   */
  FULFILLMENT_FAILED,

  /**
   * indicates the txn to fulfill the order has been reverted for a reason
   */
  FULFILLMENT_REVERTED,

  /**
   * indicates the unable to estimate preliminary fulfill
   */
  UNABLE_PRELIMINARY_FULFILL,

  /**
   * indicates that unable to estimate fulfill tx
   */
  UNABLE_ESTIMATE_EVM_TX,

  /**
   * indicates that final fulfill tx requires more gas units
   */
  REQUIRE_MORE_GAS_EVM_TX,

  /**
   * Unexpected error
   */
  INTERNAL_ERROR,
}

export enum RejectionReason {
  /**
   * indicates that the order on the give chain locks a token which is not registered in any token buckets in the executor’s configuration
   */
  UNEXEPECTED_GIVE_TOKEN,
  ALREADY_FULFILLED,
  ALREADY_CANCELLED,

  /**
   * indicates that the order on the give chain has non-zero status (e.g., unlocked)
   */
  WRONG_GIVE_STATUS,

  /**
   * indicates that the order is missing on the give chain.
   * This is extremely unlikely, and indicates protocol discrepancy if happens
   */
  ALERT_GIVE_MISSING,

  /**
   * indicates that the order is revoked.
   */
  ORDER_REVOKED,

  /**
   * indicates that announced block confirmations is less than the block confirmation constraint
   */
  ANNOUNCED_BLOCK_CONFIRMATIONS_LESS_THAN_CONSTRAINT,

  /**
   * indicates that non-finalized order is not covered by any custom block confirmation range
   */
  NON_FINALIZED_ORDER,
}
