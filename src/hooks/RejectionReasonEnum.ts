export enum RejectionReasonEnum {
  UNEXEPECTED_GIVE_TOKEN, // indicates that the order on the give chain locks a token which is not registered in any token buckets in the executor’s configuration
  ALREADY_FULFILLED,
  ALREADY_CANCELLED,
  WRONG_GIVE_STATUS, // indicates that the order on the give chain has non-zero status (e.g., unlocked)
  ALERT_GIVE_MISSING, // indicates that the order is missing on the give chain. This is extremely unlikely, and indicates protocol discrepancy if happens
}
