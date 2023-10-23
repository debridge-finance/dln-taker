import { ChainId } from '@debridge-finance/dln-client';
import Web3 from 'web3';
import { EIP1551Fee, EvmFeeManager, findMaxBigInt } from './feeManager';
import { BroadcastedTx } from './signer';

export class BumpedFeeManager extends EvmFeeManager {
  readonly #bumpGasPriceMultiplier: number;

  constructor(bumpGasPriceMultiplier: number, chainId: ChainId, connection: Web3) {
    super(chainId, connection);
    this.#bumpGasPriceMultiplier = bumpGasPriceMultiplier;
  }

  /**
   * Increases optimistic fee if the new txn must overbid (replace) the existing one
   */
  async getRequiredFee(replaceTx?: BroadcastedTx): Promise<EIP1551Fee> {
    const fees = await this.getOptimisticFee();

    if (!replaceTx) return fees;

    // if we need to replace a transaction, we must bump both maxPriorityFee and maxFeePerGas
    fees.maxPriorityFeePerGas = findMaxBigInt(
      fees.maxPriorityFeePerGas,
      BigInt(replaceTx.tx.maxPriorityFeePerGas?.toString() || 0n) *
        BigInt(this.#bumpGasPriceMultiplier),
    );

    fees.maxFeePerGas = findMaxBigInt(
      fees.baseFee + fees.maxPriorityFeePerGas,
      BigInt(replaceTx.tx.maxFeePerGas?.toString() || 0n) * BigInt(this.#bumpGasPriceMultiplier),
    );

    return fees;
  }

  async getRequiredLegacyFee(replaceTx?: BroadcastedTx): Promise<bigint> {
    let gasPrice = await this.getOptimisticLegacyFee();

    if (replaceTx) {
      const replacementTxGasPrice =
        BigInt(replaceTx.tx.gasPrice?.toString() || 0n) * BigInt(this.#bumpGasPriceMultiplier);
      if (replacementTxGasPrice > gasPrice) gasPrice = replacementTxGasPrice;
    }

    return gasPrice;
  }
}
