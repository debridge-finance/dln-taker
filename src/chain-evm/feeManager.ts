import { ChainId } from '@debridge-finance/dln-client';
import Web3 from 'web3';
import { SupportedChain } from '../config';
import { assert } from '../errors';

export type EIP1551Fee = {
  baseFee: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

// see https://docs.rs/ethers-core/latest/src/ethers_core/types/chain.rs.html#55-166
const eip1559Compatible: { [key in SupportedChain]: boolean } = {
  [ChainId.Arbitrum]: true,
  [ChainId.Avalanche]: true,
  [ChainId.BSC]: false,
  [ChainId.Ethereum]: true,
  [ChainId.Fantom]: false,
  [ChainId.Linea]: true,
  [ChainId.Polygon]: true,
  [ChainId.Solana]: false,
  [ChainId.Base]: true,
  [ChainId.Optimism]: true,
};

export function findMaxBigInt(...bigInts: Array<bigint>) {
  return bigInts.reduce((max, curr) => (curr > max ? curr : max), 0n);
}

export class EvmFeeManager {
  readonly #chainId;

  readonly #connection: Web3;

  constructor(chainId: ChainId, connection: Web3) {
    this.#chainId = chainId;
    this.#connection = connection;
  }

  get isLegacy(): boolean {
    return eip1559Compatible[this.#chainId as unknown as SupportedChain] === false;
  }

  async estimateNextGasPrice(): Promise<bigint> {
    if (this.isLegacy) {
      return this.getOptimisticLegacyFee();
    }

    const fee = await this.getOptimisticFee();
    return fee.maxFeePerGas;
  }

  /**
   * Priority fee: takes a p75 tip across latest and pending block if any of them is utilized > 50%. Otherwise, takes p50
   * Base fee: takes max base fee across pending and next-to-pending block (in case we are late to be included in the
   * pending block, and we are sure that next-to-pending block is almost ready)
   */
  async getOptimisticFee(): Promise<EIP1551Fee> {
    assert(!this.isLegacy, 'Unsupported method');

    const history = await this.#connection.eth.getFeeHistory(2, 'pending', [25, 50]);

    // tip is taken depending of two blocks: latest, pending. If any of them is utilized > 50%, put the highest (p75) bid
    const expectedBaseGasGrowth = Math.max(...history.gasUsedRatio) > 0.5;
    const takePercentile = expectedBaseGasGrowth ? 1 : 0;
    const maxPriorityFeePerGas = findMaxBigInt(
      ...history.reward.map((r) => BigInt(r[takePercentile])),
    );

    // however, the base fee must be taken according to pending and next-to-pending block, because that's were we compete
    // for block space
    const baseFee = findMaxBigInt(...history.baseFeePerGas.map((r) => BigInt(r)).slice(-2));

    return {
      baseFee,
      maxFeePerGas: baseFee + maxPriorityFeePerGas,
      maxPriorityFeePerGas,
    };
  }

  async getOptimisticLegacyFee(): Promise<bigint> {
    assert(this.isLegacy, 'Unsupported method');
    let price = BigInt(await this.#connection.eth.getGasPrice());

    // BNB chain: ensure gas price is between [3gwei, 5gwei]
    if (this.#chainId === ChainId.BSC) {
      price = findMaxBigInt(3_000_000_000n, price); // >=3gwei
      price = findMaxBigInt(price, 5_000_000_000n); // <=5gwei
    }

    return price;
  }
}
