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
   * indicates the unable to estimate preliminary fulfill
   */
  FULFILLMENT_EVM_TX_PREESTIMATION_FAILED,

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

  /**
   * indicates that the order is missing on the give chain. One of the possible reasons is a lag in the RPC node, which
   * is often the case when it comes to Solana
   */
  MISSING,
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
