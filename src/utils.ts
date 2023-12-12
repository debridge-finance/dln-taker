export function safeIntToBigInt(v: number): bigint {
  return BigInt(Math.trunc(v));
}

export function findMaxBigInt(...bigInts: Array<bigint>) {
  return bigInts.reduce((max, curr) => (curr > max ? curr : max), 0n);
}
