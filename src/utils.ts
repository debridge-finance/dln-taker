export function safeIntToBigInt(v: number): bigint {
  return BigInt(Math.trunc(v));
}
