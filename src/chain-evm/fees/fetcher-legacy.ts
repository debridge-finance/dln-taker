import Web3 from 'web3';
import { safeIntToBigInt } from '../../utils';
import { defaultFeeManagerOpts } from './defaults';
import { GasCategory } from './types';

export const legacyFeeFetcher =
  (multipliers: { [key in GasCategory]: number }) =>
  async (gasCategory: GasCategory, connection: Web3): Promise<bigint> => {
    const gasPrice = BigInt(await connection.eth.getGasPrice());
    return (gasPrice * safeIntToBigInt(multipliers[gasCategory] * 10_000)) / 10_000n;
  };

export const defaultLegacyFeeFetcher = legacyFeeFetcher({
  [GasCategory.PROJECTED]: defaultFeeManagerOpts.legacyGasPriceProjectedMultiplier,
  [GasCategory.NORMAL]: defaultFeeManagerOpts.legacyGasPriceNormalMultiplier,
  [GasCategory.AGGRESSIVE]: defaultFeeManagerOpts.legacyGasPriceAggressiveMultiplier,
});
