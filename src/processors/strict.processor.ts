import {ChainId, OrderData, PMMClient} from "@debridge-finance/dln-client";
import { helpers } from "@debridge-finance/solana-utils";
import Web3 from "web3";

import { ExecutorConfig } from "../config";

import {OrderProcessor, OrderProcessorContext, OrderProcessorInitContext} from "./order.processor";
import { SolanaProviderAdapter } from "../providers/solana.provider.adapter";
import { EvmAdapterProvider } from "../providers/evm.provider.adapter";
import { convertAddressToBuffer } from "../utils/convert.address.to.buffer";
import { buffersAreEqual } from "../utils/buffers.are.equal";
import { approveToken } from "./utils/approve";
import {ProviderAdapter} from "../providers/provider.adapter";
import {Logger} from "pino";

export class StrictProcessor extends OrderProcessor {
  private approvedTokensInBuffer: Uint8Array[];
  constructor(private readonly approvedTokens: string[]) {
    super();
  }

  private takeProviderUnlock?: ProviderAdapter;

  private takeProviderFulfill?: ProviderAdapter;

  async init(chainId: ChainId, context: OrderProcessorInitContext): Promise<void> {
    this.chainId = chainId;
    this.context = context;
    const chainConfig = context.executorConfig.chains.find(chain => chain.chain === chainId)!;
    this.approvedTokensInBuffer = this.approvedTokens.map(token => convertAddressToBuffer(chainConfig.chain, token));
    if (chainId !== ChainId.Solana) {
      for (const token of this.approvedTokens) {
        await approveToken(chainId, token, chainConfig!.environment!.pmmDst!, context)
      }
    }

    this.takeProviderUnlock = context.providersForUnlock.get(chainId);
    this.takeProviderFulfill = context.providersForFulfill.get(chainId);
    this.takeWeb3 = this.takeProviderFulfill?.connection as Web3;

    return Promise.resolve();
  }

  async process(orderId: string, order: OrderData, executorConfig: ExecutorConfig, context: OrderProcessorContext): Promise<void> {
    const giveWeb3 = context.providersForFulfill.get(order.give.chainId)!.connection as Web3;
    const logger = context.logger.child({ processor: "strictProcessor" });

    if (!this.isAllowedToken(order)) {
      logger.info(`takeToken ${helpers.bufferToHex(order.take.tokenAddress)} is not allowed`);
      return;
    }

    const fees = await this.getFee(order, executorConfig.tokenPriceService!, context.client, giveWeb3, logger);
    const executionFeeAmount = await context.client.getAmountToSend(order.take.chainId, order.give.chainId, fees.executionFees.total, this.takeWeb3!);
    logger.debug(`executionFeeAmount=${JSON.stringify(executionFeeAmount)}`);

    const fulfillTx = await this.createOrderFullfillTx(orderId, order, context.client, logger);

    if (context.orderFulfilledMap.has(orderId)) {
      context.orderFulfilledMap.delete(orderId);
      logger.error(`transaction is fulfilled`);
      return;
    }

    try {
      const txFulfill = await this.takeProviderFulfill!.sendTransaction(fulfillTx, { logger });
      logger.info(`fulfill transaction ${txFulfill} is completed`);
    }
    catch (e) {
      console.error(e)
      logger.info(`fulfill transaction failed: ${e}`);
      return;
    }
    await this.waitIsOrderFulfilled(orderId, order, context, logger);

    const beneficiary = executorConfig.chains.find((chain) => chain.chain === order.give.chainId)!.beneficiary;
    const unlockTx = await this.createOrderUnlockTx(order, beneficiary, executionFeeAmount, fees, logger, context.client);
    const transactionUnlock = await this.takeProviderUnlock!.sendTransaction(unlockTx, { logger });
    logger.info(`unlock transaction ${transactionUnlock} is completed`);

    return Promise.resolve(undefined);
  }

  private async createOrderUnlockTx(order: OrderData, beneficiary: string, executionFeeAmount: bigint, fees: any, logger: Logger, client: PMMClient) { //todo fix any
    let payload: any;
    if (order.take.chainId === ChainId.Solana) {
      const wallet = (this.takeProviderUnlock as SolanaProviderAdapter).wallet.publicKey;
      payload = {
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
      payload = {
        web3: (this.takeProviderUnlock as EvmAdapterProvider).connection,
        ...rewards,
      };
    }
    const unlockTx = await client.sendUnlockOrder<ChainId.Polygon>(
      order,
      beneficiary,
      executionFeeAmount,
      payload,
    );
    logger.debug(`unlockTx is created in ${order.take.chainId} ${JSON.stringify(unlockTx)}`);
    return unlockTx;
  }

  private async createOrderFullfillTx(orderId: string, order: OrderData, client: PMMClient, logger: Logger) {
    let fulFillPayload: any;
    if (order.take.chainId === ChainId.Solana) {
      const wallet = (this.takeProviderFulfill as SolanaProviderAdapter).wallet.publicKey;
      fulFillPayload = {
        taker: wallet,
      };
    } else {
      fulFillPayload = {
          web3: (this.takeProviderFulfill as EvmAdapterProvider).connection,
          fulfillAmount: Number(order.take.amount),
          permit: "0x",
          unlockAuthority: this.takeProviderUnlock!.address,
        };
    }
    const fulfillTx = await client.fulfillOrder<ChainId.Solana>(
      order,
      orderId,
      fulFillPayload,
    );
    logger.debug(`fulfillTx is created in ${order.take.chainId} ${JSON.stringify(fulfillTx)}`);
    return fulfillTx;
  }

  private isAllowedToken(order: OrderData): boolean {
    return this.approvedTokensInBuffer.some(address => buffersAreEqual(order.take.tokenAddress, address));
  }
}

export const strictProcessor = (approvedTokens: string[]): OrderProcessor => {
  return new StrictProcessor(approvedTokens);
};
