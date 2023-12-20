import { getFloat, getBoolean, getInt } from '../../env-utils';
import { EvmFeeManagerOpts } from './manager';

export const defaultFeeManagerOpts: EvmFeeManagerOpts = {
  gasLimitMultiplier: getFloat('EVM_FEE_MANAGER__GAS_LIMIT_MULTIPLIER', 1.1),

  legacyGasPriceProjectedMultiplier: getFloat(
    'EVM_FEE_MANAGER__LEGACY_GAS_PRICE_PROJECTED_MULTIPLIER',
    1.1,
  ),
  legacyGasPriceNormalMultiplier: getFloat(
    'EVM_FEE_MANAGER__LEGACY_GAS_PRICE_NORMAL_MULTIPLIER',
    1.1,
  ),
  legacyGasPriceAggressiveMultiplier: getFloat(
    'EVM_FEE_MANAGER__LEGACY_GAS_PRICE_AGGRESSIVE_MULTIPLIER',
    1.3,
  ),
  legacyEnforceAggressive: getBoolean('EVM_FEE_MANAGER__LEGACY_ENFORCE_AGGRESSIVE', false),

  eip1559BaseFeeProjectedMultiplier: getFloat(
    'EVM_FEE_MANAGER__EIP1559_BASE_FEE_PROJECTED_MULTIPLIER',
    1.075,
  ),
  eip1559BaseFeeNormalMultiplier: getFloat(
    'EVM_FEE_MANAGER__EIP1559_BASE_FEE_NORMAL_MULTIPLIER',
    1.075,
  ),
  eip1559BaseFeeAggressiveMultiplier: getFloat(
    'EVM_FEE_MANAGER__EIP1559_BASE_FEE_AGGRESSIVE_MULTIPLIER',
    1.125,
  ),
  eip1559PriorityFeeProjectedPercentile: getFloat(
    'EVM_FEE_MANAGER__EIP1559_PRIORITY_FEE_PROJECTED_PERCENTILE',
    50,
  ),
  eip1559PriorityFeeNormalPercentile: getFloat(
    'EVM_FEE_MANAGER__EIP1559_PRIORITY_FEE_NORMAL_PERCENTILE',
    50,
  ),
  eip1559PriorityFeeAggressivePercentile: getFloat(
    'EVM_FEE_MANAGER__EIP1559_PRIORITY_FEE_AGGRESSIVE_PERCENTILE',
    75,
  ),
  eip1559PriorityFeeIncreaseBoundary: getFloat(
    'EVM_FEE_MANAGER__EIP1559_PRIORITY_FEE_INCREASE_BOUNDARY',
    200,
  ),
  eip1559EnforceAggressive: getBoolean('EVM_FEE_MANAGER__EIP1559_ENFORCE_AGGRESSIVE', false),

  // must be >10% higher because that's how go-ethereum is implemented
  // see https://github.com/ethereum/go-ethereum/blob/d9556533c34f9bb44b7c0212ba55a08a047babef/core/txpool/legacypool/list.go#L286-L309
  replaceBumperNormalMultiplier: getFloat(
    'EVM_FEE_MANAGER__REPLACE_BUMPER_NORMAL_MULTIPLIER',
    1.11,
  ),
  replaceBumperAggressiveMultiplier: getFloat(
    'EVM_FEE_MANAGER__REPLACE_BUMPER_AGGRESSIVE_MULTIPLIER',
    1.3,
  ),
  replaceBumperEnforceAggressive: getBoolean(
    'EVM_FEE_MANAGER__REPLACE_BUMPER_ENFORCE_AGGRESSIVE',
    true,
  ),

  overcappingAllowed: getBoolean('EVM_FEE_MANAGER__OVERCAPPING_ALLOWED', true),
  overcappingAllowance: getInt('EVM_FEE_MANAGER__OVERCAPPING_ALLOWANCE', 3),
};
