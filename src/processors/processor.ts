import {
  calculateExpectedTakeAmount,
  ChainId, optimisticSlippageBps,
  OrderData,
  PMMClient,
  PriceTokenService,
  SwapConnector, tokenAddressToString, TokensBucket
} from "@debridge-finance/dln-client";
import Web3 from "web3";

import { ExecutorConfig } from "../config";

import { OrderProcessor, OrderProcessorContext, OrderProcessorInitContext } from "./order.processor";
import { EvmAdapterProvider } from "../providers/evm.provider.adapter";
import { SolanaProviderAdapter } from "../providers/solana.provider.adapter";
import { approveToken } from "./utils/approve";
import {Logger} from "pino";
import {ProviderAdapter} from "../providers/provider.adapter";
import BigNumber from "bignumber.js";
import {createClientLogger} from "../logger";

export class PreswapProcessor extends OrderProcessor {

  private swapConnector?: SwapConnector;
  private priceTokenService?: PriceTokenService;
  private takeProviderUnlock?: ProviderAdapter;
  private takeProviderFulfill?: ProviderAdapter;

  private giveWeb3: Web3;

  constructor(private readonly minProfitabilityBps: number,) {
    super();
  }

  async init(chainId: ChainId, context: OrderProcessorInitContext): Promise<void> {
    this.chainId = chainId;
    this.context = context;
    const chainConfig = context.executorConfig.chains.find(chain => chain.chain === chainId);

    if (chainId !== ChainId.Solana) {
      const tokens: string[] = [];
      context.executorConfig!.buckets.forEach(bucket => {
        (bucket.findTokens(this.chainId) || []).forEach(token => {
          tokens.push(tokenAddressToString(this.chainId, token));
        })
      })

      await Promise.all([
        ...tokens.map(token => approveToken(chainId, token, chainConfig!.environment!.evm!.forwarderContract!, context)),
        ...tokens.map(token => approveToken(chainId, token, chainConfig!.environment!.pmmDst, context)),
      ])
    }

    this.swapConnector = context.executorConfig.swapConnector;
    this.priceTokenService = context.executorConfig.tokenPriceService;
    this.takeProviderUnlock = context.providersForUnlock.get(chainId);
    this.takeProviderFulfill = context.providersForFulfill.get(chainId);
    this.takeWeb3 = this.takeProviderFulfill?.connection as Web3;

    return Promise.resolve();
  }

  async process(orderId: string, order: OrderData, executorConfig: ExecutorConfig, context: OrderProcessorContext): Promise<void> {
    const logger = context.logger.child({ processor: "preswapProcessor" });
    const clientLogger = createClientLogger(logger);

    const bucket = executorConfig.buckets.find((bucket) =>
      bucket.findFirstToken(order.give.chainId) !== undefined &&
      bucket.findFirstToken(order.take.chainId) !== undefined,
    );
    if (bucket === undefined) {
      logger.info("no token bucket effectively covering both chains")
      return;
    }

    const giveWeb3 = context.providersForFulfill.get(order.give.chainId)!.connection as Web3;
    this.giveWeb3 = giveWeb3;

    const {
      reserveDstToken,
      requiredReserveDstAmount,
      isProfitable,
    } = await calculateExpectedTakeAmount(order, optimisticSlippageBps(), this.minProfitabilityBps, {
      client: context.client,
      giveConnection: this.giveWeb3,
      takeConnection: this.takeWeb3,
      priceTokenService: this.priceTokenService!,
      buckets: executorConfig.buckets,
      swapConnector: this.swapConnector!,
      logger: clientLogger,
    });

    if (!isProfitable) {
      logger.info('order is not profitable, skipping');
      return;
    }

    const fees = await this.getFee(order, executorConfig.tokenPriceService!, context.client, giveWeb3, logger);
    const executionFeeAmount = await context.client.getAmountToSend(order.take.chainId, order.give.chainId, fees.executionFees.total, this.takeWeb3!);
    logger.debug(`executionFeeAmount=${JSON.stringify(executionFeeAmount)}`);

    //fulfill order
    const fulfillTx = await this.createOrderFullfillTx(orderId, order, reserveDstToken, requiredReserveDstAmount, context.client, logger);
    if (context.orderFulfilledMap.has(orderId)) {
      context.orderFulfilledMap.delete(orderId);
      logger.error(`transaction is fulfilled`);
      return ;
    }

    try {
      const txFulfill = await this.takeProviderFulfill!.sendTransaction(fulfillTx.tx, { logger });
      logger.info(`fulfill transaction ${txFulfill} is completed`);
    }
    catch (e) {
      console.error(e)
      logger.error(`fulfill transaction failed: ${e}`);
      return;
    }
    await this.waitIsOrderFulfilled(orderId, order, context, logger);

    const beneficiary = executorConfig.chains.find((chain) => chain.chain === order.give.chainId)!.beneficiary;

    const unlockTx = await this.createOrderUnlockTx(orderId, order, beneficiary, executionFeeAmount, fees, context.client, logger);
    const txUnlock = await this.takeProviderUnlock!.sendTransaction(unlockTx, { logger });
    logger.info(`unlock transaction ${txUnlock} is completed`);
  }

  private async createOrderUnlockTx(orderId: string, order: OrderData, beneficiary: string, executionFeeAmount: bigint, fees: any, client: PMMClient, logger: Logger) { //todo fix any
    let unlockTxPayload: any;
    if (order.take.chainId === ChainId.Solana) {
      const wallet = (this.takeProviderUnlock as SolanaProviderAdapter).wallet.publicKey;
      unlockTxPayload = {
        unlocker: wallet,
      };
    } else {
      const rewards =
        order.give.chainId === ChainId.Solana
          ? {
            reward1: fees.executionFees.rewards[0].toString(),
            reward2: fees.executionFees.rewards[1].toString(),
          }
          : {
            reward1: "0",
            reward2: "0",
          };
      unlockTxPayload = {
          web3: (this.takeProviderUnlock as EvmAdapterProvider).connection,
        ...rewards,
      };
    }
    unlockTxPayload.loggerInstance = createClientLogger(logger);

    const unlockTx = await client.sendUnlockOrder<ChainId.Solana>(
      order,
      orderId,
      beneficiary,
      executionFeeAmount,
      unlockTxPayload
    );
    logger.debug(`unlockTx is created in ${order.take.chainId} ${JSON.stringify(unlockTx)}`);

    return unlockTx;
  }

  private async createOrderFullfillTx(orderId: string, order: OrderData, reserveDstToken: Uint8Array, reservedAmount: string, client: PMMClient, logger: Logger) {
    let fullFillTxPayload: any;
    if (order.take.chainId === ChainId.Solana) {
      const wallet = (this.takeProviderFulfill as SolanaProviderAdapter).wallet.publicKey;
      fullFillTxPayload = {
        taker: wallet,
      };
    } else {

      fullFillTxPayload = {
        web3: this.takeWeb3,
        permit: "0x",
        takerAddress: this.takeProviderFulfill!.address,
        unlockAuthority: this.takeProviderUnlock!.address,
      };
    }
    fullFillTxPayload.swapConnector = this.swapConnector!;
    fullFillTxPayload.reservedAmount = reservedAmount;
    fullFillTxPayload.slippageBps = optimisticSlippageBps();
    fullFillTxPayload.loggerInstance = createClientLogger(logger);
    const fulfillTx = await client.preswapAndFulfillOrder(order, orderId, reserveDstToken, fullFillTxPayload);
    logger.debug(`fulfillTx is created in ${order.take.chainId} ${JSON.stringify(fulfillTx)}`);

    return fulfillTx;
  }
}

export const processor = (minProfitabilityBps: number): OrderProcessor => {
  return new PreswapProcessor(minProfitabilityBps);
};
