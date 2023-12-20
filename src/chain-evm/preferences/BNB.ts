import Web3 from 'web3';
import { getBigInt } from '../../env-utils';
import { GasCategory } from '../fees/types';
import { SuggestedOpts } from './store';

const MIN_GAS_PRICE = getBigInt('EVM_BNB_MIN_GAS_PRICE', 3_000_000_000n);
const MAX_GAS_PRICE = getBigInt('EVM_BNB_MAX_GAS_PRICE', 5_000_000_000n);

export const legacyFeeFetcher = async (
  gasCategory: GasCategory,
  connection: Web3,
): Promise<bigint> => {
  const minGasPrice = gasCategory === GasCategory.AGGRESSIVE ? MAX_GAS_PRICE : MIN_GAS_PRICE;
  let gasPrice = BigInt(await connection.eth.getGasPrice());
  if (gasPrice < minGasPrice) gasPrice = minGasPrice;
  if (gasPrice > MAX_GAS_PRICE) gasPrice = MAX_GAS_PRICE;
  return gasPrice;
};

export const suggestedOpts: SuggestedOpts = {
  feeHandlers: () => ({
    legacyFeeFetcher,
  }),
};
