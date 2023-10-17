export enum Hooks {
  OrderFeedConnected,
  OrderFeedDisconnected,
  OrderRejected,
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
  NOT_PROFITABLE,

  /**
   * indicates the inability to ensure the inclusion of the txn into the blockchain (e.g., we were unable to get the txn hash in the reasonable amount of time, or the RPC node is unavailable)
   */
  FULFILLMENT_TX_FAILED,

  /**
   * indicates the txn to fulfill the order has been reverted for a reason
   */
  FULFILLMENT_TX_REVERTED,

  /**
   * indicates the unable to estimate preliminary fulfill
   */
  FULFILLMENT_EVM_TX_PREESTIMATION_FAILED,

  /**
   * indicates that unable to estimate fulfill tx
   */
  FULFILLMENT_EVM_TX_ESTIMATION_FAILED,

  /**
   * indicates that final fulfill tx requires more gas units
   */
  FULFILLMENT_EVM_TX_ESTIMATION_EXCEEDED_PREESTIMATION,

  /**
   * Unexpected error
   */
  UNHANDLED_ERROR,

  /**
   * indicates that this order is forcibly delayed according to this dln-takers instance configuration
   */
  FORCED_DELAY,

  /**
   * triggered when the value of a new order potentially increases the TVL of the source chain beyond the given budget
   * (if being successfully fulfilled).
   */
  TVL_BUDGET_EXCEEDED,

  /**
   * triggered when throughput has reached its limit for the given give chain
   */
  CAPPED_THROUGHPUT,
}

export enum RejectionReason {
  /**
   * indicates that the order on the give chain locks a token which is not registered in any token buckets in the executor’s configuration
   */
  UNEXPECTED_GIVE_TOKEN,

  /**
   * order is already fulfilled
   */
  ALREADY_FULFILLED_OR_CANCELLED,

  /**
   * indicates that the order on the give chain has non-zero status (e.g., unlocked)
   */
  UNEXPECTED_GIVE_STATUS,

  /**
   * indicates that the order is missing on the give chain.
   * This is extremely unlikely, and indicates protocol discrepancy if happens
   */
  MISSING,

  /**
   * indicates that the order is revoked due to chain reorg
   */
  REVOKED,

  /**
   * indicates that announced block confirmations is less than the block confirmation constraint
   */
  NOT_ENOUGH_BLOCK_CONFIRMATIONS_FOR_ORDER_WORTH,

  /**
   * indicates that non-finalized order is not covered by any custom block confirmation range
   */
  NOT_YET_FINALIZED,

  /**
   * indicates that the order requires reserve token to be pre-swapped to the take token, but the operation can't be
   * performed because swaps are not available on the take chain
   */
  UNAVAILABLE_PRE_FULFILL_SWAP,

  /**
   * Received malformed order from ws
   */
  MALFORMED_ORDER,

  /**
   * Indicates that order includes the provided allowedTakerDst, which differs from the taker's address
   */
  WRONG_TAKER,

  FILTERED_OFF,
}
