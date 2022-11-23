import { ChainId, OrderData, OrderState } from "@debridge-finance/pmm-client";
import { helpers } from "@debridge-finance/solana-utils";
import Web3 from "web3";

import { ExecutorConfig } from "../config";
import { evmNativeTokenAddress, solanaNativeTokenAddress } from "../constant";
import {
  MarketMakerExecutorError,
  MarketMakerExecutorErrorType,
} from "../error";

import { OrderProcessor, OrderProcessorContext } from "./order.processor";
import {EvmAdapterProvider} from "../providers/evm.provider.adapter";
import {SolanaProviderAdapter} from "../providers/solana.provider.adapter";

export const preswapProcessor = (
  inputToken: string,
  slippage: number
): OrderProcessor => {
  return async (
    orderId: string,
    order: OrderData,
    executorConfig: ExecutorConfig,
    context: OrderProcessorContext
  ) => {
    const chainConfig = executorConfig.chains.find(chain => chain.chain === order.take.chainId)!;
    const logger = context.logger.child({ processor: "preswapProcessor" });
    const takeProviderUnlock = context.providersForUnlock.get(order.take.chainId);
    const takeProviderFulfill = context.providersForFulfill.get(order.take.chainId);
    let giveWeb3: Web3;
    if (order.give.chainId !== ChainId.Solana) {
      giveWeb3 = new Web3(
        executorConfig.chains.find(
          (chain) => chain.chain === order.give.chainId
        )!.chainRpc
      );
    }

    let takeWeb3: Web3;
    if (order.take.chainId !== ChainId.Solana) {
      takeWeb3 = new Web3(chainConfig!.chainRpc);
    }

    const [giveNativePrice, takeNativePrice] = await Promise.all([
      executorConfig.tokenPriceService!.getPrice(
        order.give.chainId,
        order.give.chainId !== ChainId.Solana
          ? evmNativeTokenAddress
          : solanaNativeTokenAddress
      ),
      executorConfig.tokenPriceService!.getPrice(
        order.take.chainId,
        order.take.chainId !== ChainId.Solana
          ? evmNativeTokenAddress
          : solanaNativeTokenAddress
      ),
    ]);
    const fees = await context.client.getTakerFlowCost(
      order,
      giveNativePrice,
      takeNativePrice,
      { giveWeb3: giveWeb3!, takeWeb3: takeWeb3! }
    );
    logger.debug(`fees=${JSON.stringify(fees)}`);

    const executionFeeAmount = await context.client.getAmountToSend(
      order.take.chainId,
      order.give.chainId,
      fees.executionFees.total,
      takeWeb3!
    );
    logger.debug(`executionFeeAmount=${JSON.stringify(executionFeeAmount)}`);

    let fulfillTx;
    if (order.take.chainId === ChainId.Solana) {
      const wallet = (takeProviderFulfill as SolanaProviderAdapter).wallet.publicKey;
      fulfillTx = await context.client.preswapAndFulfillOrder<ChainId.Solana>(
        order,
        orderId,
        inputToken as unknown as string,
        {
          taker: wallet,
        }
      );
      logger.debug(
        `fulfillTx is created in solana ${JSON.stringify(fulfillTx)}`
      );
    } else {
      fulfillTx = await context.client.preswapAndFulfillOrder<ChainId.Ethereum>(
        order,
        orderId,
        inputToken as unknown as string,
        {
          web3: (takeProviderFulfill as EvmAdapterProvider).connection,
          fulfillAmount: Number(order.take.amount),
          permit: "0x",
          slippage,
          swapConnector: executorConfig.swapConnector!,
          takerAddress: takeProviderFulfill!.address,
          priceTokenService: executorConfig.tokenPriceService!,
          unlockAuthority: takeProviderUnlock!.address,
        }
      );
      logger.debug(
        `fulfillTx is created in ${order.take.chainId} ${JSON.stringify(
          fulfillTx
        )}`
      );
    }
    if (context.orderFulfilledMap.has(orderId)) {
      context.orderFulfilledMap.delete(orderId);
      throw new MarketMakerExecutorError(
        MarketMakerExecutorErrorType.OrderIsFulfilled
      );
    }

    try {
      const txFulfill = await takeProviderFulfill!.sendTransaction(fulfillTx.tx, { logger });
      logger.info(`fulfill transaction ${txFulfill} is completed`);
    }
    catch (e) {
      console.error(e)
      logger.info(`fulfill transaction failed: ${e}`);
      return;
    }

    let state = await context.client.getTakeOrderStatus(
      orderId,
      order.take.chainId,
      { web3: takeWeb3! }
    );
    console.log('🔴', { state })
    // while (state === null || state.status !== OrderState.Fulfilled) {
    //   state = await context.client.getTakeOrderStatus(
    //     orderId,
    //     order.take.chainId,
    //     { web3: takeWeb3! }
    //   );
    //   logger.debug(`state=${JSON.stringify(state)}`);
    //   await helpers.sleep(2000);
    // }

    const beneficiary = executorConfig.chains.find(
      (chain) => chain.chain === order.give.chainId
    )!.beneficiary;

    let unlockTx;
    if (order.take.chainId === ChainId.Solana) {
      const wallet = (takeProviderUnlock as SolanaProviderAdapter).wallet.publicKey;
      unlockTx = await context.client.sendUnlockOrder<ChainId.Solana>(
        order,
        beneficiary,
        executionFeeAmount,
        {
          unlocker: wallet,
        }
      );
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
      unlockTx = await context.client.sendUnlockOrder<ChainId.Polygon>(
        order,
        beneficiary,
        executionFeeAmount,
        {
          web3: (takeProviderUnlock as EvmAdapterProvider).connection,
          ...rewards,
        }
      );
    }
    const txUnlock = await takeProviderUnlock!.sendTransaction(unlockTx, { logger });
    logger.info(`unlock transaction ${txUnlock} is completed`);
  };
};
