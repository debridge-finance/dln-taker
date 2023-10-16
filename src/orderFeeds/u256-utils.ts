/* eslint-disable no-bitwise -- This helpers implement U256 arithmetics. Seems like not needed anymore because WS returns standard integers. TODO #862karjre */

import { helpers } from '@debridge-finance/solana-utils';

function BytesToU64(data: Buffer, encoding: 'le' | 'be'): bigint {
  let result: bigint = 0n;
  const leOrder = [0, 1, 2, 3, 4, 5, 6, 7];
  let counter = 0;
  for (const i of encoding === 'be' ? leOrder.reverse() : leOrder) {
    result += BigInt(data[i]) << BigInt(8 * counter);
    counter += 1;
  }
  return result;
}

export type U256Limbs = {
  limb1: bigint;
  limb2: bigint;
  limb3: bigint;
  limb4: bigint;
};

export class U256 {
  constructor(private value: U256Limbs) {}

  toBytesBE() {
    return U256.toBytesBE(this.value);
  }

  toBigInt() {
    return U256.toBigInt(this.value);
  }

  static toBytesBE(u: U256Limbs): Buffer {
    const result = Buffer.alloc(32);
    const shifts = Array.from({ length: 8 })
      .fill(0n)
      .map((/* v */ _, i) => BigInt(56 - 8 * i));
    for (let i = 0; i < 32; i++) {
      switch (Math.floor(i / 8)) {
        case 0:
          result[i] = Number((u.limb4 >> shifts[i % 8]) & 0xffn);
          break;
        case 1:
          result[i] = Number((u.limb3 >> shifts[i % 8]) & 0xffn);
          break;
        case 2:
          result[i] = Number((u.limb2 >> shifts[i % 8]) & 0xffn);
          break;
        case 3:
          result[i] = Number((u.limb1 >> shifts[i % 8]) & 0xffn);
          break;
        default:
          throw new Error('Unreachable');
      }
    }
    return result;
  }

  static toBigInt(u: U256Limbs): bigint {
    return (
      u.limb1 +
      (u.limb2 << BigInt(8 * 8 * 1)) +
      (u.limb3 << BigInt(8 * 8 * 2)) +
      (u.limb4 << BigInt(8 * 8 * 3))
    );
  }

  static fromBytesBE(data: Buffer): U256 {
    return new U256({
      limb4: BytesToU64(data.subarray(0, 8), 'be'),
      limb3: BytesToU64(data.subarray(8, 16), 'be'),
      limb2: BytesToU64(data.subarray(16, 24), 'be'),
      limb1: BytesToU64(data.subarray(24, 32), 'be'),
    });
  }

  static fromHexBEString(data: string): U256 {
    return U256.fromBytesBE(helpers.hexToBuffer(data));
  }

  static fromBigInt(n: bigint): U256 {
    const u64Mask = 0xffffffffffffffffn;
    const u64Shift = 8;
    const limb1 = n & u64Mask;
    const limb2 = (n >> BigInt(u64Shift * 1)) & u64Mask;
    const limb3 = (n >> BigInt(u64Shift * 2)) & u64Mask;
    const limb4 = (n >> BigInt(u64Shift * 3)) & u64Mask;

    return new U256({ limb1, limb2, limb3, limb4 });
  }
}
