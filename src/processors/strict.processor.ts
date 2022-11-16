import {OrderProcessor, OrderProcessorContext} from "./order.processor";
import {ChainId, OrderData, OrderState} from "@debridge-finance/pmm-client";
import {ChainConfig, ExecutorConfig} from "../config";
import Web3 from "web3";
import {evmNativeTokenAddress, solanaNativeTokenAddress} from "../constant";
import {Keypair} from "@solana/web3.js";
import {helpers} from "@debridge-finance/solana-utils";
import {createWeb3WithPrivateKey} from "./utils/create.web3.with.private.key";
import {MarketMakerExecutorError, MarketMakerExecutorErrorType} from "../error";
import {sendTransaction} from "./utils/send.transaction";

export const strictProcessor = (): OrderProcessor => {
  return async (orderId: string, order: OrderData, executorConfig: ExecutorConfig, fulfillableChainConfig: ChainConfig, context: OrderProcessorContext) => {
    const logger = context.logger.child({ processor: 'strictProcessor' });
    let giveWeb3: Web3;
    if (order.give.chainId !== ChainId.Solana) {
      giveWeb3 = new Web3(executorConfig.fulfillableChains.find(chain => chain.chain === order.give.chainId)!.chainRpc);
    }

    let takeWeb3: Web3;
    if (order.take.chainId !== ChainId.Solana) {
      takeWeb3 = new Web3(fulfillableChainConfig!.chainRpc);
    }


    const [giveNativePrice, takeNativePrice] = await Promise.all([
      executorConfig.priceTokenService!.getPrice(order.give.chainId, order.give.chainId !== ChainId.Solana ? evmNativeTokenAddress : solanaNativeTokenAddress),
      executorConfig.priceTokenService!.getPrice(order.take.chainId, order.take.chainId !== ChainId.Solana ? evmNativeTokenAddress : solanaNativeTokenAddress),
    ]);
    const fees = await context.client.getTakerFlowCost(order, giveNativePrice, takeNativePrice, { giveWeb3: giveWeb3!, takeWeb3: takeWeb3! });
    logger.debug(`fees=${JSON.stringify(fees)}`);

    const executionFeeAmount = await context.client.getAmountToSend(order.take.chainId, order.give.chainId, fees.executionFees.total, takeWeb3!);

    let fulfillTx;
    if (order.take.chainId === ChainId.Solana) {
      const wallet = Keypair.fromSecretKey(helpers.hexToBuffer(fulfillableChainConfig.wallet)).publicKey;
      fulfillTx = await context.client.fulfillOrder<ChainId.Solana>(order,  orderId, {
        taker: wallet,
      });
      logger.debug(`fulfillTx is created in solana ${JSON.stringify(fulfillTx)}`);
    }
    else {
      fulfillTx = await context.client.fulfillOrder<ChainId.Ethereum>(order, orderId, {
        web3: createWeb3WithPrivateKey(fulfillableChainConfig.chainRpc, fulfillableChainConfig.wallet),
        fulfillAmount: Number(order.take.amount),
        permit: "0x",
      });
      logger.debug(`fulfillTx is created in ${order.take.chainId} ${JSON.stringify(fulfillTx)}`);
    }

    if (context.orderFulfilledMap.has(orderId)) {
      context.orderFulfilledMap.delete(orderId);
      throw new MarketMakerExecutorError(MarketMakerExecutorErrorType.OrderIsFulfilled);
    }

    const transactionFulfill = await sendTransaction(fulfillableChainConfig, fulfillTx);
    logger.info(`fulfill transaction ${transactionFulfill} is completed`);

    let state = await context.client.getTakeOrderStatus(orderId, order.take.chainId,{ web3: takeWeb3! });
    while (state === null || state.status !== OrderState.Fulfilled) {
      state = await context.client.getTakeOrderStatus(orderId, order.take.chainId, { web3: takeWeb3! });
      logger.debug(`state=${JSON.stringify(state)}`);
      await helpers.sleep(2000);
    }

    let unlockTx;
    if (order.take.chainId === ChainId.Solana) {
      const wallet = Keypair.fromSecretKey(helpers.hexToBuffer(fulfillableChainConfig.wallet)).publicKey;
      unlockTx = await context.client.sendUnlockOrder<ChainId.Solana>(order, fulfillableChainConfig.wallet!, executionFeeAmount, {
        unlocker: wallet,
      });
      logger.debug(`unlockTx is created in solana ${JSON.stringify(unlockTx)}`);
    } else {
      const rewards = order.give.chainId === ChainId.Solana ?
        {
          reward1: fees.executionFees.rewards[0].toString(),
          reward2: fees.executionFees.rewards[1].toString(),
        } : {
          reward1: "0",
          reward2: "0",
        }
      unlockTx = await context.client.sendUnlockOrder<ChainId.Polygon>(order, fulfillableChainConfig.beneficiary!, executionFeeAmount, {
        web3: createWeb3WithPrivateKey(fulfillableChainConfig.chainRpc, fulfillableChainConfig.wallet),
        ...rewards
      });
      logger.debug(`unlockTx is created in ${order.take.chainId} ${JSON.stringify(unlockTx)}`);
    }
    const transactionUnlock = await sendTransaction(fulfillableChainConfig, unlockTx);
    logger.info(`unlock transaction ${transactionUnlock} is completed`);
  }
}
