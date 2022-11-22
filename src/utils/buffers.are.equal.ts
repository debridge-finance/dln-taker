export const buffersAreEqual = (a: Buffer | Uint8Array, b: Buffer | Uint8Array): boolean => {
  return Buffer.compare(a, b) === 0;
}
