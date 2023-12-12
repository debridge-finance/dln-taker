import { ChainId } from '@debridge-finance/dln-client';
import Web3 from 'web3';
import { findMaxBigInt, safeIntToBigInt } from '../../utils';
import { defaultFeeManagerOpts } from './defaults';
import { eip1559FeeFetcher } from './fetcher-eip1559';
import { legacyFeeFetcher } from './fetcher-legacy';
import { GasCategory } from './types';

export type TransactionTemplate = {
  from: string;
  to: string;
  data: string;
  value?: string;
  gas: number;
  nonce: number;
};
export type LegacyGasExtension = { gasPrice: string };
export type EIP1559GasExtension = {
  maxPriorityFeePerGas: string;
  maxFeePerGas: string;
};

export interface IEvmFeeManager {
  estimateTx(tx: Omit<TransactionTemplate, 'gas' | 'nonce'>): Promise<number>;
  getGasPrice(gasCategory: GasCategory): Promise<bigint>;
  populateTx<T extends EIP1559GasExtension | LegacyGasExtension>(
    tx: TransactionTemplate,
    cappedFee?: bigint,
    gasCategory?: GasCategory,
  ): Promise<TransactionTemplate & T>;
  populateReplacementTx<T extends EIP1559GasExtension | LegacyGasExtension>(
    tx: TransactionTemplate,
    originalTxn: TransactionTemplate & T,
    cappedFee?: bigint,
    gasCategory?: GasCategory,
  ): Promise<TransactionTemplate & T>;
}

export type EvmFeeOpts = {
  //
  // gas limit section
  //
  gasLimitMultiplier: number;

  //
  // legacy transaction fees section
  //
  legacyGasPriceProjectedMultiplier: number;
  legacyGasPriceNormalMultiplier: number;
  legacyGasPriceAggressiveMultiplier: number;
  legacyEnforceAggressive: boolean;

  //
  // eip1559-compliant transaction fees section
  //
  eip1559BaseFeeProjectedMultiplier: number;
  eip1559BaseFeeNormalMultiplier: number;
  eip1559BaseFeeAggressiveMultiplier: number;
  eip1559PriorityFeeProjectedPercentile: number;
  eip1559PriorityFeeNormalPercentile: number;
  eip1559PriorityFeeAggressivePercentile: number;
  eip1559PriorityFeeIncreaseBoundary: number;
  eip1559EnforceAggressive: boolean;

  //
  // bumpers for transaction replacement
  //
  replaceBumperNormalMultiplier: number;
  replaceBumperAggressiveMultiplier: number;
  replaceBumperEnforceAggressive: boolean;

  // capped fees to protect overpayment
  overcappingAllowed: boolean;
  overcappingAllowance: number;
};

export type EIP1551Fee = {
  baseFee: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

export type EvmFeeHandlers = {
  legacyFeeFetcher: (gasCategory: GasCategory, connection: Web3) => Promise<bigint>;
  feeFetcher: (gasCategory: GasCategory, connection: Web3) => Promise<EIP1551Fee>;
};

export function getDefaultHandlers(opts: EvmFeeOpts): EvmFeeHandlers {
  return {
    legacyFeeFetcher: legacyFeeFetcher({
      [GasCategory.PROJECTED]: opts.legacyGasPriceProjectedMultiplier,
      [GasCategory.NORMAL]: opts.legacyGasPriceNormalMultiplier,
      [GasCategory.AGGRESSIVE]: opts.legacyGasPriceAggressiveMultiplier,
    }),
    feeFetcher: eip1559FeeFetcher(
      {
        [GasCategory.PROJECTED]: opts.eip1559BaseFeeProjectedMultiplier,
        [GasCategory.NORMAL]: opts.eip1559BaseFeeNormalMultiplier,
        [GasCategory.AGGRESSIVE]: opts.eip1559BaseFeeAggressiveMultiplier,
      },
      {
        [GasCategory.PROJECTED]: opts.eip1559PriorityFeeProjectedPercentile,
        [GasCategory.NORMAL]: opts.eip1559PriorityFeeNormalPercentile,
        [GasCategory.AGGRESSIVE]: opts.eip1559BaseFeeAggressiveMultiplier,
      },
      opts.eip1559PriorityFeeIncreaseBoundary,
    ),
  };
}

export class CappedFeeReachedError extends Error {}

// see https://docs.rs/ethers-core/latest/src/ethers_core/types/chain.rs.html#55-166
const eip1559Compatible: { [key in number]: boolean } = {
  [ChainId.Arbitrum]: true,
  [ChainId.Avalanche]: true,
  // [ChainId.BSC]: false,
  [ChainId.Ethereum]: true,
  // [ChainId.Fantom]: false,
  [ChainId.Linea]: true,
  [ChainId.Polygon]: true,
  // [ChainId.Solana]: false,
  [ChainId.Base]: true,
  [ChainId.Optimism]: true,
};

export class EvmFeeManager implements IEvmFeeManager {
  readonly #chainId: number;

  readonly #connection: Web3;

  readonly #opts: EvmFeeOpts;

  readonly #handlers: EvmFeeHandlers;

  readonly isEip1559Compatible: boolean;

  constructor(
    chainId: number,
    connection: Web3,
    opts?: Partial<EvmFeeOpts>,
    handlers?: Partial<EvmFeeHandlers>,
    isLegacy?: boolean,
  ) {
    this.#chainId = chainId;
    this.#connection = connection;
    this.isEip1559Compatible =
      isLegacy !== undefined ? !isLegacy : !!eip1559Compatible[this.#chainId];
    this.#opts = { ...defaultFeeManagerOpts, ...(opts || {}) };
    this.#handlers = Object.assign(
      <EvmFeeHandlers>{
        legacyFeeFetcher: legacyFeeFetcher({
          [GasCategory.PROJECTED]: this.#opts.legacyGasPriceProjectedMultiplier,
          [GasCategory.NORMAL]: this.#opts.legacyGasPriceNormalMultiplier,
          [GasCategory.AGGRESSIVE]: this.#opts.legacyGasPriceAggressiveMultiplier,
        }),
        feeFetcher: eip1559FeeFetcher(
          {
            [GasCategory.PROJECTED]: this.#opts.eip1559BaseFeeProjectedMultiplier,
            [GasCategory.NORMAL]: this.#opts.eip1559BaseFeeNormalMultiplier,
            [GasCategory.AGGRESSIVE]: this.#opts.eip1559BaseFeeAggressiveMultiplier,
          },
          {
            [GasCategory.PROJECTED]: this.#opts.eip1559PriorityFeeProjectedPercentile,
            [GasCategory.NORMAL]: this.#opts.eip1559PriorityFeeNormalPercentile,
            [GasCategory.AGGRESSIVE]: this.#opts.eip1559BaseFeeAggressiveMultiplier,
          },
          this.#opts.eip1559PriorityFeeIncreaseBoundary,
        ),
      },
      handlers,
    );
  }

  async estimateTx(tx: TransactionTemplate): Promise<number> {
    const gas = await this.#connection.eth.estimateGas(tx);
    const gasLimit = Math.round(gas * this.#opts.gasLimitMultiplier);
    return gasLimit;
  }

  private async checkCapping(tx: TransactionTemplate, fee: bigint, cappedFee?: bigint) {
    if (cappedFee && cappedFee > 0n) {
      const gasLimit = BigInt(tx.gas || (await this.estimateTx(tx)));
      const txFee = fee * gasLimit;
      if (txFee > cappedFee) {
        if (this.#opts.overcappingAllowed !== true)
          throw new CappedFeeReachedError(`Overcapping disabled`);
        const maxAllowedCap =
          (cappedFee * safeIntToBigInt(this.#opts.overcappingAllowance * 10_000)) / 10_000n;
        if (txFee > maxAllowedCap)
          throw new CappedFeeReachedError(
            `Unable to populate pricing: transaction fee (txFee=${txFee}, gasPrice=${fee}, gasLimit=${gasLimit}) is greater than cappedFee (${maxAllowedCap}, overcap: ${this.#opts.overcappingAllowance})`,
          );
      }
    }
  }

  private async checkCappingAndPopulate(
    tx: TransactionTemplate,
    fee: EIP1551Fee,
    cappedFee?: bigint,
  ): Promise<TransactionTemplate & EIP1559GasExtension> {
    await this.checkCapping(tx, fee.maxFeePerGas, cappedFee);

    return {
      ...tx,
      maxFeePerGas: fee.maxFeePerGas.toString(),
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas.toString(),
    };
  }

  private async checkLegacyCappingAndPopulate(
    tx: TransactionTemplate,
    gasPrice: bigint,
    cappedFee?: bigint,
  ): Promise<TransactionTemplate & LegacyGasExtension> {
    await this.checkCapping(tx, gasPrice, cappedFee);

    return {
      ...tx,
      gasPrice: gasPrice.toString(),
    };
  }

  async populateTx<T extends EIP1559GasExtension | LegacyGasExtension>(
    tx: TransactionTemplate,
    cappedFee?: bigint,
    gasCategory?: GasCategory,
  ): Promise<TransactionTemplate & T> {
    if (this.isEip1559Compatible) {
      const effectiveGasCategory =
        gasCategory ||
        (this.#opts.eip1559EnforceAggressive ? GasCategory.AGGRESSIVE : GasCategory.NORMAL);
      const fee = await this.#handlers.feeFetcher(effectiveGasCategory, this.#connection);
      return this.checkCappingAndPopulate(tx, fee, cappedFee) as any;
    }

    const effectiveGasCategory =
      gasCategory ||
      (this.#opts.legacyEnforceAggressive ? GasCategory.AGGRESSIVE : GasCategory.NORMAL);
    const gasPrice = await this.#handlers.legacyFeeFetcher(effectiveGasCategory, this.#connection);
    return this.checkLegacyCappingAndPopulate(tx, gasPrice, cappedFee) as any;
  }

  async populateReplacementTx<T extends EIP1559GasExtension | LegacyGasExtension>(
    tx: TransactionTemplate,
    replaceTx: TransactionTemplate & T,
    cappedFee?: bigint,
    gasCategory?: GasCategory,
  ): Promise<TransactionTemplate & T> {
    const bumper = this.#opts.replaceBumperEnforceAggressive
      ? this.#opts.replaceBumperAggressiveMultiplier
      : this.#opts.replaceBumperNormalMultiplier;

    if (this.isEip1559Compatible) {
      const effectiveGasCategory =
        gasCategory ||
        (this.#opts.eip1559EnforceAggressive ? GasCategory.AGGRESSIVE : GasCategory.NORMAL);
      const fee = await this.#handlers.feeFetcher(effectiveGasCategory, this.#connection);

      // if we need to replace a transaction, we must bump both maxPriorityFee and maxFeePerGas
      fee.maxPriorityFeePerGas = findMaxBigInt(
        fee.maxPriorityFeePerGas,
        (BigInt((<EIP1559GasExtension>replaceTx).maxPriorityFeePerGas) *
          safeIntToBigInt(bumper * 10_000)) /
          10_000n,
      );

      fee.maxFeePerGas = findMaxBigInt(
        fee.baseFee + fee.maxPriorityFeePerGas,
        (BigInt((<EIP1559GasExtension>replaceTx).maxFeePerGas) * safeIntToBigInt(bumper * 10_000)) /
          10_000n,
      );

      return this.checkCappingAndPopulate(tx, fee, cappedFee) as any;
    }

    const effectiveGasCategory =
      gasCategory ||
      (this.#opts.legacyEnforceAggressive ? GasCategory.AGGRESSIVE : GasCategory.NORMAL);
    const gasPrice = findMaxBigInt(
      await this.#handlers.legacyFeeFetcher(effectiveGasCategory, this.#connection),
      (BigInt((<LegacyGasExtension>replaceTx).gasPrice || '0') * safeIntToBigInt(bumper * 10_000)) /
        10_000n,
    );
    return this.checkLegacyCappingAndPopulate(tx, gasPrice, cappedFee) as any;
  }

  async getGasPrice(gasCategory: GasCategory): Promise<bigint> {
    if (this.isEip1559Compatible) {
      const fee = await this.#handlers.feeFetcher(gasCategory, this.#connection);
      return fee.maxFeePerGas;
    }

    return this.#handlers.legacyFeeFetcher(gasCategory, this.#connection);
  }
}
