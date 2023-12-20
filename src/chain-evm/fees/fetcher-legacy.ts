import { Logger } from 'pino';
import Web3 from 'web3';
import { safeIntToBigInt } from '../../utils';
import { defaultFeeManagerOpts } from './defaults';
import { GasCategory } from './types';

export const getLegacyFeeFetcher =
  (multipliers: { [key in GasCategory]: number }) =>
  async (gasCategory: GasCategory, connection: Web3, logger?: Logger): Promise<bigint> => {
    const gasPrice = BigInt(await connection.eth.getGasPrice());
    const finalGasPrice = (gasPrice * safeIntToBigInt(multipliers[gasCategory] * 10_000)) / 10_000n;
    logger?.debug(
      `retrieved legacy gasPrice: ${finalGasPrice} (gasPrice=${gasPrice}, gasCategory: ${GasCategory[gasCategory]}, multiplier: ${multipliers[gasCategory]})`,
    );
    return finalGasPrice;
  };

export const defaultLegacyFeeFetcher = getLegacyFeeFetcher({
  [GasCategory.PROJECTED]: defaultFeeManagerOpts.legacyGasPriceProjectedMultiplier,
  [GasCategory.NORMAL]: defaultFeeManagerOpts.legacyGasPriceNormalMultiplier,
  [GasCategory.AGGRESSIVE]: defaultFeeManagerOpts.legacyGasPriceAggressiveMultiplier,
});
