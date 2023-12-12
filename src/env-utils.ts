export function getFloat(name: string, defaultValue: number): number {
  return parseFloat(process.env[name] || '0') || defaultValue;
}
export function getBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return defaultValue;
}
export function getInt(name: string, defaultValue: number): number {
  return Math.trunc(getFloat(name, defaultValue));
}
export function getBigInt(name: string, defaultValue: bigint): bigint {
  const v = (process.env[name] || '0').match(/^\d+/)?.[0] || '0';
  return BigInt(v) || defaultValue;
}
