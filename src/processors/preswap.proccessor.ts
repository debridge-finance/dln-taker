import {
  ChainId,
  OrderData,
  PMMClient,
  PriceTokenService,
  SwapConnector
} from "@debridge-finance/dln-client";
import Web3 from "web3";

import { ExecutorConfig } from "../config";

import { OrderProcessor, OrderProcessorContext, OrderProcessorInitContext } from "./order.processor";
import { EvmAdapterProvider } from "../providers/evm.provider.adapter";
import { SolanaProviderAdapter } from "../providers/solana.provider.adapter";
import { approveToken } from "./utils/approve";
import {Logger} from "pino";
import {ProviderAdapter} from "../providers/provider.adapter";

export class PreswapProcessor extends OrderProcessor {

  private swapConnector?: SwapConnector;
  private priceTokenService?: PriceTokenService;
  private takeProviderUnlock?: ProviderAdapter;
  private takeProviderFulfill?: ProviderAdapter;

  constructor(private readonly inputToken: string,
              private readonly slippage: number = 3) {
    super();
  }

  async init(chainId: ChainId, context: OrderProcessorInitContext): Promise<void> {
    this.chainId = chainId;
    this.context = context;
    const chainConfig = context.executorConfig.chains.find(chain => chain.chain === chainId);
    if (chainId !== ChainId.Solana) {
      await approveToken(chainId, this.inputToken, chainConfig!.environment!.evm!.forwarderContract!, context);
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

    const giveWeb3 = context.providersForFulfill.get(order.give.chainId)!.connection as Web3;

    const fees = await this.getFee(order, executorConfig.tokenPriceService!, context.client, giveWeb3, logger);
    const executionFeeAmount = await context.client.getAmountToSend(order.take.chainId, order.give.chainId, fees.executionFees.total, this.takeWeb3!);
    logger.debug(`executionFeeAmount=${JSON.stringify(executionFeeAmount)}`);

    //fulfill order
    const fulfillTx= await this.createOrderFullfillTx(orderId, order, context.client, logger);
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

    const unlockTx = await this.createOrderUnlockTx(order, beneficiary, executionFeeAmount, fees, context.client, logger);
    const txUnlock = await this.takeProviderUnlock!.sendTransaction(unlockTx, { logger });
    logger.info(`unlock transaction ${txUnlock} is completed`);
  }

  private async createOrderUnlockTx(order: OrderData, beneficiary: string, executionFeeAmount: bigint, fees: any, client: PMMClient, logger: Logger) { //todo fix any
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
    const unlockTx = await client.sendUnlockOrder<ChainId.Solana>(
      order,
      beneficiary,
      executionFeeAmount,
      unlockTxPayload
    );
    logger.debug(`unlockTx is created in ${order.take.chainId} ${JSON.stringify(unlockTx)}`);

    return unlockTx;
  }

  private async createOrderFullfillTx(orderId: string, order: OrderData, client: PMMClient, logger: Logger) {
    let fullFillTxPayload;
    if (order.take.chainId === ChainId.Solana) {
      const wallet = (this.takeProviderFulfill as SolanaProviderAdapter).wallet.publicKey;
      fullFillTxPayload = {
        taker: wallet,
      };
    } else {
      fullFillTxPayload = {
        web3: this.takeWeb3,
        fulfillAmount: Number(order.take.amount),
        permit: "0x",
        slippage: this.slippage,
        swapConnector: this.swapConnector!,
        takerAddress: this.takeProviderFulfill!.address,
        priceTokenService: this.priceTokenService!,
        unlockAuthority: this.takeProviderUnlock!.address,
      };
    }
    const fulfillTx = await client.preswapAndFulfillOrder(order, orderId, this.inputToken, fullFillTxPayload);
    logger.debug(`fulfillTx is created in ${order.take.chainId} ${JSON.stringify(fulfillTx)}`);

    return fulfillTx;
  }
}

export const preswapProcessor = (
  inputToken: string,
  slippage: number = 3
): OrderProcessor => {
  return new PreswapProcessor(inputToken, slippage);
};
