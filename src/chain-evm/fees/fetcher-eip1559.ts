import Web3 from 'web3';
import { findMaxBigInt, safeIntToBigInt } from '../../utils';
import { defaultFeeManagerOpts } from './defaults';
import { GasCategory } from './types';

export type EIP1551Fee = {
  baseFee: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

// based on work by [MyCrypto](https://github.com/MyCryptoHQ/MyCrypto/blob/master/src/services/ApiService/Gas/eip1559.ts)
export function priorityFeeEstimator(history: string[][], increaseBoundary: number = 200): bigint {
  const tips = history
    .map((r) => BigInt(r[0]))
    .filter((r) => r !== 0n)
    .sort();

  if (tips.length === 0) return 0n;
  if (tips.length === 1) return tips[0];

  // Calculate percentage increases from between ordered list of fees
  const percentageIncreases = tips.reduce(
    (acc, cur, i, arr) => {
      if (i === arr.length - 1) {
        return acc;
      }
      const next = arr[i + 1];
      const p = ((next - cur) * 100n) / cur;
      return [...acc, p];
    },
    <bigint[]>[],
  );

  const highestIncrease = findMaxBigInt(...percentageIncreases);
  const highestIncreaseIndex = percentageIncreases.findIndex((p) => p === highestIncrease);

  // If we have big increase in value, we could be considering "outliers" in our estimate
  // Skip the low elements and take a new median
  const values =
    highestIncrease >= increaseBoundary && highestIncreaseIndex >= Math.floor(tips.length / 2)
      ? tips.slice(highestIncreaseIndex)
      : tips;

  return values[Math.floor(values.length / 2)];
}

export const eip1559FeeFetcher =
  (
    baseFeeMultipliers: { [key in GasCategory]: number },
    priorityFeePercentiles: { [key in GasCategory]: number },
    priorityFeeIncreaseBoundary: number = 200,
  ) =>
  async (gasCategory: GasCategory, connection: Web3): Promise<EIP1551Fee> => {
    const history = await connection.eth.getFeeHistory(10, 'pending', [
      priorityFeePercentiles[gasCategory],
    ]);

    // take median
    const maxPriorityFeePerGas = priorityFeeEstimator(
      history.reward || [],
      priorityFeeIncreaseBoundary,
    );

    // however, the base fee must be taken according to pending and next-to-pending block, because that's were we compete
    // for block space
    const baseFee = findMaxBigInt(...history.baseFeePerGas.map((r) => BigInt(r)).slice(-2));
    const targetBaseFee =
      (baseFee * safeIntToBigInt(baseFeeMultipliers[gasCategory] * 10_000)) / 10_000n;

    return {
      baseFee: targetBaseFee,
      maxFeePerGas: targetBaseFee + maxPriorityFeePerGas,
      maxPriorityFeePerGas,
    };
  };

export const defaultEip1559FeeFetcher = eip1559FeeFetcher(
  {
    [GasCategory.PROJECTED]: defaultFeeManagerOpts.eip1559BaseFeeProjectedMultiplier,
    [GasCategory.NORMAL]: defaultFeeManagerOpts.eip1559BaseFeeNormalMultiplier,
    [GasCategory.AGGRESSIVE]: defaultFeeManagerOpts.eip1559BaseFeeAggressiveMultiplier,
  },
  {
    [GasCategory.PROJECTED]: defaultFeeManagerOpts.eip1559PriorityFeeProjectedPercentile,
    [GasCategory.NORMAL]: defaultFeeManagerOpts.eip1559PriorityFeeNormalPercentile,
    [GasCategory.AGGRESSIVE]: defaultFeeManagerOpts.eip1559BaseFeeAggressiveMultiplier,
  },
  defaultFeeManagerOpts.eip1559PriorityFeeIncreaseBoundary,
);
