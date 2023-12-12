import chai, { expect } from 'chai';
import Web3 from 'web3';
import chaiAsPromised from 'chai-as-promised';
import { legacyFeeFetcher } from './fetcher-legacy';
import { GasCategory } from './types';

chai.use(chaiAsPromised);

describe('Legacy fee fetching', () => {
  it('defaultLegacyFeeFetcher', async () => {
    const gasCategoryMultipliers = {
      [GasCategory.PROJECTED]: 1,
      [GasCategory.NORMAL]: 1.11,
      [GasCategory.AGGRESSIVE]: 3.21,
    };

    const mockedGasPrice = 10_000_000_000n.toString();
    const expectedFees: Array<[gasCategory: GasCategory, b: bigint]> = [
      [GasCategory.PROJECTED, 10_000_000_000n],
      [GasCategory.NORMAL, 11_100_000_000n],
      [GasCategory.AGGRESSIVE, 32_100_000_000n],
    ];

    const conn = <Web3>{
      eth: {
        getGasPrice: async () => mockedGasPrice.toString(),
      },
    };
    for (const [gasCategory, expectedGasPrice] of expectedFees) {
      const feeFetcher = legacyFeeFetcher(gasCategoryMultipliers);
      expect(await feeFetcher(gasCategory, conn)).to.eq(
        expectedGasPrice,
        `mocked: ${GasCategory[gasCategory]}`,
      );
    }
  });
});
