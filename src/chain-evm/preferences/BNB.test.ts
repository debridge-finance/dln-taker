import assert from 'assert';
import Web3 from 'web3';
import { GasCategory } from '../fees/types';
import { legacyFeeFetcher } from './BNB';

describe('BNB', () => {
  it('legacyFeeFetcher must return corrected values for projected', async () => {
    const testSuite = [
      [2_000_000_000n, 3_000_000_000n],
      [3_000_000_000n, 3_000_000_000n],
      [4_000_000_000n, 4_000_000_000n],
      [5_000_000_000n, 5_000_000_000n],
      [6_000_000_000n, 5_000_000_000n],
    ];

    for (const [mocked, expected] of testSuite) {
      const conn = <Web3>{
        eth: {
          getGasPrice: async () => mocked.toString(),
        },
      };
      assert.equal(
        await legacyFeeFetcher(GasCategory.PROJECTED, conn),
        expected,
        `${mocked} mocked`,
      );
    }
  });
});
