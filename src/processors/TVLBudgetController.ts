import {
  Address,
  ChainId,
  Logger as ClientLogger,
  OrderState,
  PMMClient, PriceTokenService,
  TokensBucket, tokenStringToBuffer
} from "@debridge-finance/dln-client";
import { Logger } from "pino";
import { createClientLogger } from "../logger";
import BigNumber from "bignumber.js";
import { StatsAPI } from "./stats_api/StatsAPI";
import {ProviderAdapter} from "../providers/provider.adapter";
import Web3 from "web3";

type Config = {
  giveChainId: ChainId;
  beneficiary: string;
  fulfillProvider: ProviderAdapter;
  TVLBudget: number,
};

type GlobalConfig = {
  unlockAuthorities: string[];
  priceTokenService: PriceTokenService;
  dlnClient: PMMClient;
  statsApi: StatsAPI;
};

export class TVLBudgetController {

  private static unlockAuthorities: string[] = [];
  private static buckets: TokensBucket[];
  private static priceTokenService: PriceTokenService;
  private static dlnClient: PMMClient;
  private static statsApi: StatsAPI;

  private readonly giveChainId: ChainId;
  private readonly beneficiary: Address;
  private readonly fulfillProvider: ProviderAdapter;
  private readonly taker: Address;
  private readonly TVLBudget: number;
  private readonly reservedTokens: Address[];

  static setGlobalConfig(config: GlobalConfig) {
    TVLBudgetController.unlockAuthorities = config.unlockAuthorities;
    TVLBudgetController.priceTokenService = config.priceTokenService;
    TVLBudgetController.dlnClient = config.dlnClient;
    TVLBudgetController.statsApi = config.statsApi;
  }

  constructor(config: Config, buckets: TokensBucket[]) {
    this.giveChainId = config.giveChainId;
    this.TVLBudget = config.TVLBudget;
    this.fulfillProvider = config.fulfillProvider;
    this.beneficiary = tokenStringToBuffer(this.giveChainId, config.beneficiary);
    this.taker = tokenStringToBuffer(this.giveChainId, config.fulfillProvider.address);
    const reservedTokens: Address[] = [];
    buckets.forEach(bucket => {
      const tokensInBucket = bucket?.findTokens(this.giveChainId);
      if (tokensInBucket) {
        reservedTokens.push(...tokensInBucket);
      }
    });
    this.reservedTokens = reservedTokens;
  }

  async validate(logger: Logger): Promise<boolean> {
    if (this.TVLBudget === 0) {
      return true;
    }
    const clientLogger = createClientLogger(logger.child({ service: TVLBudgetController.name }));

    const takerUsdBalance = (await Promise.all(this.reservedTokens.map(async token => {
      return this.getAccountUsdBalance(this.giveChainId, token, this.beneficiary, clientLogger);
    }))).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
    logger.debug(`takerUsdBalance in give chain ${ChainId[this.giveChainId]} is ${takerUsdBalance}`);

    const beneficiaryUsdBalance = (await Promise.all(this.reservedTokens.map(async token => {
      return this.getAccountUsdBalance(this.giveChainId, token, this.taker, clientLogger);
    }))).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
    logger.debug(`beneficiaryUsdBalance in give chain ${ChainId[this.giveChainId]} is ${beneficiaryUsdBalance}`);

    const orders = await TVLBudgetController.statsApi.getOrders([this.giveChainId], [OrderState.Fulfilled, OrderState.SentUnlock], TVLBudgetController.unlockAuthorities.join(' '));
    const orderGiveAmountUsd = (await Promise.all(orders.map(order => {
      const giveToken = tokenStringToBuffer(this.giveChainId, order.giveOfferWithMetadata.tokenAddress.stringValue);
      const giveAmount = order.giveOfferWithMetadata.amount.stringValue;
      return this.convertTokenAmountToUsd(this.giveChainId, giveToken, giveAmount, clientLogger)
    }))).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
    logger.debug(`orderGiveAmountUsd in give chain ${ChainId[this.giveChainId]} is ${orderGiveAmountUsd}`);

    const giveAmountBalanceUsd =  orderGiveAmountUsd + beneficiaryUsdBalance + takerUsdBalance;
    const result = this.TVLBudget > giveAmountBalanceUsd;
    logger.debug(`TVLBudget ${this.TVLBudget} > giveAmountBalanceUsd ${giveAmountBalanceUsd} : ${result}`);
    return result;
  }

  private async getAccountUsdBalance(chainId: ChainId, tokenAddress: Address, accountAddress: Address, clientLogger: ClientLogger): Promise<number> {
    const tokenBalance = await TVLBudgetController.dlnClient.getAccountBalance(chainId, tokenAddress, accountAddress, this.fulfillProvider.connection as Web3);
    return this.convertTokenAmountToUsd(chainId, tokenAddress, tokenBalance.toString(), clientLogger);
  }

  private async convertTokenAmountToUsd(chainId: ChainId, tokenAddress: Address, amount: string, clientLogger: ClientLogger): Promise<number> {
    const tokenPrice = await TVLBudgetController.priceTokenService.getPrice(chainId, tokenAddress, {
      logger: clientLogger,
    });
    const tokenDecimals = await TVLBudgetController.dlnClient.getDecimals(chainId, tokenAddress, this.fulfillProvider.connection as Web3);
    return new BigNumber(amount.toString()).multipliedBy(tokenPrice).div(new BigNumber(10).pow(tokenDecimals)).toNumber();
  }
}