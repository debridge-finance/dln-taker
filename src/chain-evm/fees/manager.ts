import { Logger } from 'pino';
import Web3 from 'web3';
import { findMaxBigInt, safeIntToBigInt } from '../../utils';
import { defaultFeeManagerOpts } from './defaults';
import { EIP1551Fee, getEip1559FeeFetcher } from './fetcher-eip1559';
import { getLegacyFeeFetcher } from './fetcher-legacy';
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
  estimateTx(
    tx: Omit<TransactionTemplate, 'gas' | 'nonce'>,
    context: EvmFeeManagerCtx,
  ): Promise<number>;
  getGasPrice(gasCategory: GasCategory, context: EvmFeeManagerCtx): Promise<bigint>;
  populateTx<T extends EIP1559GasExtension | LegacyGasExtension>(
    tx: TransactionTemplate,
    cappedFee: bigint | undefined,
    gasCategory: GasCategory | undefined,
    context: EvmFeeManagerCtx,
  ): Promise<TransactionTemplate & T>;
  populateReplacementTx<T extends EIP1559GasExtension | LegacyGasExtension>(
    tx: TransactionTemplate,
    originalTxn: TransactionTemplate & T,
    cappedFee: bigint | undefined,
    gasCategory: GasCategory | undefined,
    context: EvmFeeManagerCtx,
  ): Promise<TransactionTemplate & T>;
}

type EvmFeeManagerCtx = {
  logger: Logger;
};

export type EvmFeeManagerOpts = {
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

export type EvmFeeFetchers = {
  legacyFeeFetcher: (gasCategory: GasCategory, connection: Web3, logger: Logger) => Promise<bigint>;
  feeFetcher: (gasCategory: GasCategory, connection: Web3, logger: Logger) => Promise<EIP1551Fee>;
};

export function getDefaultFetchers(opts: EvmFeeManagerOpts): EvmFeeFetchers {
  return {
    legacyFeeFetcher: getLegacyFeeFetcher({
      [GasCategory.PROJECTED]: opts.legacyGasPriceProjectedMultiplier,
      [GasCategory.NORMAL]: opts.legacyGasPriceNormalMultiplier,
      [GasCategory.AGGRESSIVE]: opts.legacyGasPriceAggressiveMultiplier,
    }),
    feeFetcher: getEip1559FeeFetcher(
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

export class EvmFeeManager implements IEvmFeeManager {
  readonly #connection: Web3;

  readonly #opts: EvmFeeManagerOpts;

  readonly #fetchers: EvmFeeFetchers;

  readonly isEip1559Compatible: boolean;

  constructor(
    connection: Web3,
    isLegacy: boolean,
    opts?: Partial<EvmFeeManagerOpts>,
    handlers?: Partial<EvmFeeFetchers>,
  ) {
    this.#connection = connection;
    this.isEip1559Compatible = !isLegacy;
    this.#opts = { ...defaultFeeManagerOpts, ...(opts || {}) };
    this.#fetchers = Object.assign(
      <EvmFeeFetchers>{
        legacyFeeFetcher: getLegacyFeeFetcher({
          [GasCategory.PROJECTED]: this.#opts.legacyGasPriceProjectedMultiplier,
          [GasCategory.NORMAL]: this.#opts.legacyGasPriceNormalMultiplier,
          [GasCategory.AGGRESSIVE]: this.#opts.legacyGasPriceAggressiveMultiplier,
        }),
        feeFetcher: getEip1559FeeFetcher(
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

  async estimateTx(tx: TransactionTemplate, context: EvmFeeManagerCtx): Promise<number> {
    context.logger.debug(`trying to estimate txn: ${JSON.stringify(tx)}`);

    const gas = await this.#connection.eth.estimateGas(tx);
    const gasLimit = Math.round(gas * this.#opts.gasLimitMultiplier);
    context.logger.debug(
      `estimated: ${gas}, gas limit: ${gasLimit} (used multiplier: ${this.#opts.gasLimitMultiplier})`,
    );

    return gasLimit;
  }

  private async checkCapping(
    tx: TransactionTemplate,
    gasPrice: bigint,
    cappedFee: bigint | undefined,
    context: EvmFeeManagerCtx,
  ) {
    if (cappedFee && cappedFee > 0n) {
      const gasLimit = BigInt(tx.gas || (await this.estimateTx(tx, context)));
      const txFee = gasPrice * gasLimit;
      context.logger.debug(
        `checking if txn fee (gasLimit=${gasLimit}, gasPrice=${gasPrice}, txFee=${txFee}) exceeds capping (cappedFee=${cappedFee}, overcappingAllowance=${this.#opts.overcappingAllowance})`,
      );
      if (txFee > cappedFee) {
        if (this.#opts.overcappingAllowed !== true)
          throw new CappedFeeReachedError(`Overcapping disabled`);
        const maxAllowedCap =
          (cappedFee * safeIntToBigInt(this.#opts.overcappingAllowance * 10_000)) / 10_000n;
        if (txFee > maxAllowedCap)
          throw new CappedFeeReachedError(
            `Unable to populate pricing: transaction fee (txFee=${txFee}, gasPrice=${gasPrice}, gasLimit=${gasLimit}) is greater than cappedFee (${maxAllowedCap}, overcap: ${this.#opts.overcappingAllowance})`,
          );
      }
    }
  }

  private async checkCappingAndPopulate(
    tx: TransactionTemplate,
    fee: EIP1551Fee,
    cappedFee: bigint | undefined,
    context: EvmFeeManagerCtx,
  ): Promise<TransactionTemplate & EIP1559GasExtension> {
    await this.checkCapping(tx, fee.maxFeePerGas, cappedFee, context);

    context.logger.debug(
      `populating fee: maxFeePerGas=${fee.maxFeePerGas}, maxPriorityFeePerGas=${fee.maxPriorityFeePerGas}`,
    );
    return {
      ...tx,
      maxFeePerGas: fee.maxFeePerGas.toString(),
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas.toString(),
    };
  }

  private async checkLegacyCappingAndPopulate(
    tx: TransactionTemplate,
    gasPrice: bigint,
    cappedFee: bigint | undefined,
    context: EvmFeeManagerCtx,
  ): Promise<TransactionTemplate & LegacyGasExtension> {
    await this.checkCapping(tx, gasPrice, cappedFee, context);

    context.logger.debug(`populating fee: gasPrice=${gasPrice}`);
    return {
      ...tx,
      gasPrice: gasPrice.toString(),
    };
  }

  async populateTx<T extends EIP1559GasExtension | LegacyGasExtension>(
    tx: TransactionTemplate,
    cappedFee: bigint | undefined,
    gasCategory: GasCategory | undefined,
    context: EvmFeeManagerCtx,
  ): Promise<TransactionTemplate & T> {
    if (this.isEip1559Compatible) {
      const effectiveGasCategory =
        gasCategory ||
        (this.#opts.eip1559EnforceAggressive ? GasCategory.AGGRESSIVE : GasCategory.NORMAL);
      const fee = await this.#fetchers.feeFetcher(
        effectiveGasCategory,
        this.#connection,
        context.logger,
      );
      return this.checkCappingAndPopulate(tx, fee, cappedFee, context) as any;
    }

    const effectiveGasCategory =
      gasCategory ||
      (this.#opts.legacyEnforceAggressive ? GasCategory.AGGRESSIVE : GasCategory.NORMAL);
    const gasPrice = await this.#fetchers.legacyFeeFetcher(
      effectiveGasCategory,
      this.#connection,
      context.logger,
    );
    return this.checkLegacyCappingAndPopulate(tx, gasPrice, cappedFee, context) as any;
  }

  async populateReplacementTx<T extends EIP1559GasExtension | LegacyGasExtension>(
    tx: TransactionTemplate,
    replaceTx: TransactionTemplate & T,
    cappedFee: bigint | undefined,
    gasCategory: GasCategory | undefined,
    context: EvmFeeManagerCtx,
  ): Promise<TransactionTemplate & T> {
    const bumper = this.#opts.replaceBumperEnforceAggressive
      ? this.#opts.replaceBumperAggressiveMultiplier
      : this.#opts.replaceBumperNormalMultiplier;

    if (this.isEip1559Compatible) {
      const effectiveGasCategory =
        gasCategory ||
        (this.#opts.eip1559EnforceAggressive ? GasCategory.AGGRESSIVE : GasCategory.NORMAL);
      const fee = await this.#fetchers.feeFetcher(
        effectiveGasCategory,
        this.#connection,
        context.logger,
      );

      // if we need to replace a transaction, we must bump both maxPriorityFee and maxFeePerGas
      fee.maxPriorityFeePerGas = findMaxBigInt(
        fee.maxPriorityFeePerGas,
        (BigInt((<EIP1559GasExtension>replaceTx).maxPriorityFeePerGas) *
          safeIntToBigInt(bumper * 10_000)) /
          10_000n,
      );
      context.logger.debug(
        `bumped maxPriorityFeePerGas: ${
          fee.maxPriorityFeePerGas
        } (bumper=${bumper}, replacement txn maxPriorityFeePerGas=${
          (<EIP1559GasExtension>replaceTx).maxPriorityFeePerGas
        })`,
      );

      fee.maxFeePerGas = findMaxBigInt(
        fee.baseFee + fee.maxPriorityFeePerGas,
        (BigInt((<EIP1559GasExtension>replaceTx).maxFeePerGas) * safeIntToBigInt(bumper * 10_000)) /
          10_000n,
      );
      context.logger.debug(
        `bumped maxFeePerGas: ${
          fee.maxFeePerGas
        } (bumper=${bumper}, replacement txn maxPriorityFeePerGas=${
          (<EIP1559GasExtension>replaceTx).maxFeePerGas
        })`,
      );

      return this.checkCappingAndPopulate(tx, fee, cappedFee, context) as any;
    }

    const effectiveGasCategory =
      gasCategory ||
      (this.#opts.legacyEnforceAggressive ? GasCategory.AGGRESSIVE : GasCategory.NORMAL);
    const gasPrice = findMaxBigInt(
      await this.#fetchers.legacyFeeFetcher(effectiveGasCategory, this.#connection, context.logger),
      (BigInt((<LegacyGasExtension>replaceTx).gasPrice) * safeIntToBigInt(bumper * 10_000)) /
        10_000n,
    );
    context.logger.debug(
      `bumped gasPrice: ${gasPrice} (bumper=${bumper}, replacement txn gasPrice=${
        (<LegacyGasExtension>replaceTx).gasPrice
      })`,
    );

    return this.checkLegacyCappingAndPopulate(tx, gasPrice, cappedFee, context) as any;
  }

  async getGasPrice(gasCategory: GasCategory, context: EvmFeeManagerCtx): Promise<bigint> {
    if (this.isEip1559Compatible) {
      const fee = await this.#fetchers.feeFetcher(gasCategory, this.#connection, context.logger);
      return fee.maxFeePerGas;
    }

    return this.#fetchers.legacyFeeFetcher(gasCategory, this.#connection, context.logger);
  }
}
