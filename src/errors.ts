export function die(message: string) {
  // eslint-disable-next-line no-console -- Enable access to console log explicitly for dying
  console.trace(message);
  process.exit(1);
}

export function assert(validation: boolean, message: string) {
  if (!validation) die(message);
}
