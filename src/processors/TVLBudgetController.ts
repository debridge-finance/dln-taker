import { Address, buffersAreEqual, ChainId } from '@debridge-finance/dln-client';
import NodeCache from 'node-cache';
import { Logger } from 'pino';
import { ExecutorSupportedChain, IExecutor } from '../executor';

enum TvlCacheKey {
  TVL,
}

// 30m cache is OK because the cache is being flushed on every fulfilled order
const DEFAULT_TVL_CACHE_TTL = 30 * 60;

export class TVLBudgetController {
  public readonly budget: number;

  private readonly chain: ChainId;

  private readonly executor: IExecutor;

  private readonly cache = new NodeCache({
    stdTTL: DEFAULT_TVL_CACHE_TTL,
    // this cache is intended to store Promises. Using clones causes node to crash when a race condition occurs
    useClones: false,
  });

  private readonly logger: Logger;

  constructor(chain: ChainId, executor: IExecutor, budget: number, logger: Logger) {
    this.chain = chain;
    this.executor = executor;
    this.budget = budget;
    this.logger = logger.child({ service: TVLBudgetController.name, chainId: chain, budget });
    if (budget) {
      this.logger.info(`Will preserve a TVL of $${budget} on ${ChainId[chain]}`);
    }
  }

  get giveChain(): ExecutorSupportedChain {
    return this.executor.chains[this.chain]!;
  }

  get hasSeparateUnlockBeneficiary(): boolean {
    return !buffersAreEqual(
      this.giveChain.fulfillAuthority.bytesAddress,
      this.giveChain.unlockBeneficiary,
    );
  }

  get trackedTokens(): Address[] {
    return this.executor.buckets
      .map((bucket) => bucket.findTokens(this.chain) || [])
      .reduce((prev, curr) => [...prev, ...curr], []);
  }

  flushCache(): void {
    this.cache.del(TvlCacheKey.TVL);
  }

  async getCurrentTVL(): Promise<number> {
    const cachedTVL = this.cache.get<Promise<number>>(TvlCacheKey.TVL);
    if (undefined === cachedTVL) {
      // to avoid simultaneous requests from different take_chains for the same giveTVL,
      // we introduce a promisified synchronization root here
      // Mind that this promise gets erased once resolved
      this.cache.set(TvlCacheKey.TVL, this.calculateCurrentTVL());
    }

    return this.cache.get<Promise<number>>(TvlCacheKey.TVL)!;
  }

  async calculateCurrentTVL(): Promise<number> {
    const takerAccountBalance = await this.getTakerAccountBalance();
    const unlockBeneficiaryAccountBalance = await this.getUnlockBeneficiaryAccountBalance();
    const pendingUnlockOrdersValue = await this.getPendingUnlockOrdersValue();

    const tvl = takerAccountBalance + unlockBeneficiaryAccountBalance + pendingUnlockOrdersValue;
    return tvl;
  }

  private async getTakerAccountBalance(): Promise<number> {
    if (this.giveChain.disabledFulfill) return 0;
    return this.getAccountValue(this.giveChain.fulfillAuthority.bytesAddress);
  }

  private async getUnlockBeneficiaryAccountBalance(): Promise<number> {
    if (this.giveChain.disabledFulfill) return 0;
    if (!this.hasSeparateUnlockBeneficiary) return 0;
    return this.getAccountValue(this.giveChain.unlockBeneficiary);
  }

  private async getAccountValue(account: Address): Promise<number> {
    const usdValues = await Promise.all(
      this.trackedTokens.map((token) => this.getAssetValueAtAccount(token, account)),
    );

    return usdValues.reduce((prevValue, value) => prevValue + value, 0);
  }

  private async getAssetValueAtAccount(token: Address, account: Address): Promise<number> {
    const balance = await this.executor.client
      .getClient(this.chain)
      .getBalance(this.chain, token, account);
    const usdValue = await this.executor.usdValueOfAsset(this.chain, token, balance);
    return usdValue;
  }

  private async getPendingUnlockOrdersValue(): Promise<number> {
    const orders = await this.executor.dlnApi.getPendingForUnlockOrders(this.chain);

    const usdValues = await Promise.all(
      orders.map((order) => this.executor.usdValueOfOrder(order)),
    );

    return usdValues.reduce((prevValue, value) => prevValue + value, 0);
  }
}
