import { ChainId, OrderData, OrderState } from "@debridge-finance/pmm-client";
import { helpers } from "@debridge-finance/solana-utils";
import { Keypair } from "@solana/web3.js";
import Web3 from "web3";

import { ExecutorConfig } from "../config";
import { evmNativeTokenAddress, solanaNativeTokenAddress } from "../constant";
import {
  MarketMakerExecutorError,
  MarketMakerExecutorErrorType,
} from "../error";

import { OrderProcessor, OrderProcessorContext } from "./order.processor";
import { createWeb3WithPrivateKey } from "./utils/create.web3.with.private.key";
import { sendTransaction } from "./utils/send.transaction";

export const strictProcessor = (approvedTokens: string[]): OrderProcessor => {
  return async (
    orderId: string,
    order: OrderData,
    executorConfig: ExecutorConfig,
    context: OrderProcessorContext
  ) => {
    const chainConfig = executorConfig.chains.find(chain => chain.chain === order.take.chainId)!;
    const logger = context.logger.child({ processor: "strictProcessor" });

    const takeToken = helpers.bufferToHex(Buffer.from(order.take.tokenAddress));
    if (!approvedTokens.map(token => token.toLowerCase()).includes(takeToken)) {
      logger.info(`takeToken ${takeToken} is not allowed`);
      return;
    }
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

    let fulfillTx;
    if (order.take.chainId === ChainId.Solana) {
      const wallet = Keypair.fromSecretKey(
        helpers.hexToBuffer(chainConfig.takerPrivateKey)
      ).publicKey;
      fulfillTx = await context.client.fulfillOrder<ChainId.Solana>(
        order,
        orderId,
        {
          taker: wallet,
        }
      );
      logger.debug(
        `fulfillTx is created in solana ${JSON.stringify(fulfillTx)}`
      );
    } else {
      fulfillTx = await context.client.fulfillOrder<ChainId.Ethereum>(
        order,
        orderId,
        {
          web3: createWeb3WithPrivateKey(
            chainConfig.chainRpc,
            chainConfig.takerPrivateKey
          ),
          fulfillAmount: Number(order.take.amount),
          permit: "0x",
          unlockAuthority: createWeb3WithPrivateKey(chainConfig.chainRpc, chainConfig.takerPrivateKey).eth.defaultAccount!,
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

    const transactionFulfill = await sendTransaction(chainConfig, fulfillTx);
    logger.info(`fulfill transaction ${transactionFulfill} is completed`);

    let state = await context.client.getTakeOrderStatus(
      orderId,
      order.take.chainId,
      { web3: takeWeb3! }
    );
    while (state === null || state.status !== OrderState.Fulfilled) {
      state = await context.client.getTakeOrderStatus(
        orderId,
        order.take.chainId,
        { web3: takeWeb3! }
      );
      logger.debug(`state=${JSON.stringify(state)}`);
      await helpers.sleep(2000);
    }

    const beneficiary = executorConfig.chains.find(
      (chain) => chain.chain === order.give.chainId
    )!.beneficiary;

    let unlockTx;
    if (order.take.chainId === ChainId.Solana) {
      const wallet = Keypair.fromSecretKey(
        helpers.hexToBuffer(chainConfig.takerPrivateKey)
      ).publicKey;
      unlockTx = await context.client.sendUnlockOrder<ChainId.Solana>(
        order,
        beneficiary,
        executionFeeAmount,
        {
          unlocker: wallet,
        }
      );
      logger.debug(`unlockTx is created in solana ${JSON.stringify(unlockTx)}`);
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
          web3: createWeb3WithPrivateKey(
            chainConfig.chainRpc,
            chainConfig.takerPrivateKey
          ),
          ...rewards,
        }
      );
      logger.debug(
        `unlockTx is created in ${order.take.chainId} ${JSON.stringify(
          unlockTx
        )}`
      );
    }
    const transactionUnlock = await sendTransaction(chainConfig, unlockTx);
    logger.info(`unlock transaction ${transactionUnlock} is completed`);
  };
};
