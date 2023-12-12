import chai, { expect } from 'chai';
import Web3 from 'web3';
import chaiAsPromised from 'chai-as-promised';
import { CappedFeeReachedError, EvmFeeManager, LegacyGasExtension } from './manager';
import { GasCategory } from './types';
import { createTestFrameworkLogger } from '../../../tests/helpers/index';

chai.use(chaiAsPromised);

describe('EvmFeeManager', () => {
  describe('Checking legacy transaction population', () => {
    it('should populateTx with disabled capping', async () => {
      const lowGas = 30n;
      const highGas = 50n;
      const gasLimit = 1000n;
      const cappingAllowance = gasLimit * highGas - 1n;
      const conn = <Web3>{
        eth: {
          estimateGas: async (_transactionConfig: any) => Number(gasLimit.toString()),
        },
      };

      const manager = new EvmFeeManager(
        conn,
        true,
        {
          gasLimitMultiplier: 1,
          overcappingAllowed: false,
        },
        {
          legacyFeeFetcher: async (gasCategory) =>
            gasCategory === GasCategory.AGGRESSIVE ? highGas : lowGas,
        },
      );

      // Normal gas category: gas is set as is
      const tx = await manager.populateTx<LegacyGasExtension>(
        <any>{},
        cappingAllowance,
        GasCategory.NORMAL,
        { logger: createTestFrameworkLogger() },
      );
      expect(tx.gasPrice).to.eq('30');

      // Must exceed capped gas
      await expect(
        manager.populateTx(<any>{}, cappingAllowance, GasCategory.AGGRESSIVE, {
          logger: createTestFrameworkLogger(),
        }),
      ).to.be.rejectedWith(CappedFeeReachedError, 'Overcapping disabled');
    });

    it('should populateTx with overcapping allowed', async () => {
      const gas = 20n;
      const gasLimit = 1000n;
      const cappingAllowance = gasLimit * gas - 1n;
      const conn = <Web3>{
        eth: {
          estimateGas: async (_transactionConfig: any) => Number(gasLimit.toString()),
        },
      };

      const manager = new EvmFeeManager(
        conn,
        true,
        {
          gasLimitMultiplier: 1,
          overcappingAllowed: true,
          overcappingAllowance: 2,
        },
        {
          legacyFeeFetcher: async (gasCategory) =>
            gasCategory === GasCategory.AGGRESSIVE ? gas * 2n : gas,
        },
      );

      // Normal gas category: gas is set as is
      const tx = await manager.populateTx<LegacyGasExtension>(
        <any>{},
        cappingAllowance,
        GasCategory.NORMAL,
        { logger: createTestFrameworkLogger() },
      );
      expect(tx.gasPrice).to.eq('20');

      // Must exceed capped gas
      await expect(
        manager.populateTx(<any>{}, cappingAllowance, GasCategory.AGGRESSIVE, {
          logger: createTestFrameworkLogger(),
        }),
      ).to.be.rejectedWith(CappedFeeReachedError, 'Unable to populate pricing');
    });
  });
});
