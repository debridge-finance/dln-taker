import chai, { expect } from 'chai';
import Web3 from 'web3';
import chaiAsPromised from 'chai-as-promised';
import { safeIntToBigInt } from '../../utils';
import { EIP1551Fee, eip1559FeeFetcher, priorityFeeEstimator } from './fetcher-eip1559';
import { GasCategory } from './types';

chai.use(chaiAsPromised);

describe('EIP1559 fee fetchers', () => {
  it('defaultEip1559FeeFetcher', async () => {
    const baseFeeMultipliers = {
      [GasCategory.PROJECTED]: 1.125,
      [GasCategory.NORMAL]: 1.125,
      [GasCategory.AGGRESSIVE]: 1.125 * 2,
    };
    const priorityFeePercentiles = {
      [GasCategory.PROJECTED]: 25,
      [GasCategory.NORMAL]: 25,
      [GasCategory.AGGRESSIVE]: 50,
    };
    const baseFee = 2e9;
    const priorityFee = 102_000_000_000n;

    const mockedGasPrice = (1e6).toString();

    const expectedFees: Array<[gasCategory: GasCategory, fees: EIP1551Fee]> = [
      [
        GasCategory.NORMAL,
        {
          baseFee: safeIntToBigInt(baseFee * baseFeeMultipliers[GasCategory.NORMAL]),
          maxFeePerGas:
            priorityFee + safeIntToBigInt(baseFee * baseFeeMultipliers[GasCategory.NORMAL]),
          maxPriorityFeePerGas: priorityFee,
        },
      ],
      [
        GasCategory.AGGRESSIVE,
        {
          baseFee: safeIntToBigInt(baseFee * baseFeeMultipliers[GasCategory.AGGRESSIVE]),
          maxFeePerGas:
            priorityFee + safeIntToBigInt(baseFee * baseFeeMultipliers[GasCategory.AGGRESSIVE]),
          maxPriorityFeePerGas: priorityFee,
        },
      ],
    ];

    const conn = <Web3>{
      eth: {
        getGasPrice: async () => mockedGasPrice.toString(),
        getFeeHistory(_blockCount, _lastBlock, _rewardPercentiles) {
          return Promise.resolve({
            baseFeePerGas: [baseFee.toString()],
            reward: [
              [100_000_000_000n.toString()],
              [105_000_000_000n.toString()],
              [102_000_000_000n.toString()],
            ],
          });
        },
      },
    };
    for (const [gasCategory, expectedFee] of expectedFees) {
      const feeFetcher = eip1559FeeFetcher(baseFeeMultipliers, priorityFeePercentiles);
      const actualFee = await feeFetcher(gasCategory, conn);
      expect(actualFee).to.deep.eq(expectedFee, `mocked: ${GasCategory[gasCategory]}`);
    }
  });

  it('defaultPriorityFeeEstimator should correctly pick a tip', async () => {
    const rewards = [
      [100_000_000_000n.toString()],
      [105_000_000_000n.toString()],
      [102_000_000_000n.toString()],
    ];

    // The median should be taken because none of the changes are big enough to ignore values.
    expect(priorityFeeEstimator(rewards)).to.eq(102_000_000_000n);
  });
});
