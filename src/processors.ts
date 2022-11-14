import {ExecutorConfig, FulfillableChainConfig, OrderProcessor} from "./config";
import {Address} from "./pmm_common";
import {ChainId, OrderData, OrderState, PMMClient} from "@debridge-finance/pmm-client";
import {Connection, Keypair, PublicKey, Transaction, TransactionInstruction} from "@solana/web3.js";
import Web3 from "web3";
import logger from "loglevel";
import {helpers} from "@debridge-finance/solana-utils";
import {evmNativeTokenAddress, solanaNativeTokenAddress} from "./constant";
import {MarketMakerExecutorError, MarketMakerExecutorErrorType} from "./error";

function createWeb3WithPrivateKey(rpc: string, privateKey: string) {
    const web3 = new Web3(rpc);
    const accountEvmFromPrivateKey = web3.eth.accounts.privateKeyToAccount(privateKey);
    web3.eth.accounts.wallet.add(accountEvmFromPrivateKey);
    web3.eth.defaultAccount = accountEvmFromPrivateKey.address;

    return web3;
}

async function sendSolanaTransaction(solanaConnection: Connection, keypair: Keypair, data: unknown) {
    const wallet = {
        publicKey: keypair.publicKey,
        signAllTransactions: (txs: Transaction[]) => {
            txs.map((tx) => {
                tx.partialSign(keypair);
            });
            return Promise.resolve(txs);
        },
        signTransaction: (tx: Transaction) => {
            tx.sign(keypair);
            return Promise.resolve(tx);
        },
    };
    const txid = await helpers.sendAll(
      solanaConnection,
      wallet,
      [new Transaction().add(data as Transaction | TransactionInstruction)],
      undefined,
      undefined,
      false,
      true,
    );
    logger.log(`[Solana] Sent tx: ${txid}`);
    return txid;
}

async function sendEvmTransaction(web3: Web3, data: unknown) {
    const tx = data as { data: string; to: string; value: number };
    const gasLimit = await web3.eth.estimateGas(tx);
    const gasPrice = await web3.eth.getGasPrice();
    const result = await web3.eth.sendTransaction({
        ...tx,
        from: web3.eth.defaultAccount!,
        gasPrice,
        gas: gasLimit,
    });
    logger.log(`[EVM] Sent tx: ${result.transactionHash}`);

    return result;
}

async function sendTransaction(fulfillableChainConfig: FulfillableChainConfig, data: unknown) {
    if (fulfillableChainConfig.chain === ChainId.Solana) {
        const solanaConnection = new Connection(fulfillableChainConfig.chainRpc);
        const keyPair = Keypair.fromSecretKey(helpers.hexToBuffer(fulfillableChainConfig.wallet));
        await sendSolanaTransaction(solanaConnection, keyPair, data);
    } else {
        const web3 = await createWeb3WithPrivateKey(fulfillableChainConfig.chainRpc, fulfillableChainConfig.wallet);
        await sendEvmTransaction(web3, data);
    }
}

/**
 * Represents an order fulfillment engine which fulfills orders taking the exact amount from the wallet
 */
export function matchProcessor(): OrderProcessor {
    return async (order: OrderData, executorConfig: ExecutorConfig, fulfillableChainConfig: FulfillableChainConfig, client: PMMClient) => {
        let giveWeb3: Web3;
        if (order.give.chainId !== ChainId.Solana) {
            giveWeb3 = new Web3(fulfillableChainConfig!.chainRpc);
        }

        let takeWeb3: Web3;
        if (order.take.chainId !== ChainId.Solana) {
            takeWeb3 = new Web3(fulfillableChainConfig!.chainRpc);
        }

        const giveAddress = helpers.bufferToHex(Buffer.from(order.give.tokenAddress));
        const takeAddress = helpers.bufferToHex(Buffer.from(order.take.tokenAddress));

        const [giveNativePrice, takeNativePrice] = await Promise.all([
            executorConfig.priceTokenService!.getPrice(order.give.chainId, order.give.chainId !== ChainId.Solana ? evmNativeTokenAddress : solanaNativeTokenAddress),
            executorConfig.priceTokenService!.getPrice(order.take.chainId, order.take.chainId !== ChainId.Solana ? evmNativeTokenAddress : solanaNativeTokenAddress),
            executorConfig.priceTokenService!.getPrice(order.give.chainId, giveAddress),
            executorConfig.priceTokenService!.getPrice(order.take.chainId, takeAddress),
            client.getDecimals(order.give.chainId, giveAddress, giveWeb3!),
            client.getDecimals(order.take.chainId, takeAddress, takeWeb3!),
        ]);
        const fees = await client.getTakerFlowCost(order, giveNativePrice, takeNativePrice, { giveWeb3: giveWeb3!, takeWeb3: takeWeb3! });
        logger.log(`matchProcessor fees=${JSON.stringify(fees)}`);

        const executionFeeAmount = await client.getAmountToSend(order.take.chainId, order.give.chainId, fees.executionFees.total, takeWeb3!);

        let fulfillTx;
        if (order.take.chainId === ChainId.Solana) {
            const wallet = new PublicKey(fulfillableChainConfig.wallet);
            fulfillTx = await client.fulfillOrder<ChainId.Solana>(order, {
                taker: wallet,
            });
            logger.log(`matchProcessor fulfillTx is created in solana ${JSON.stringify(fulfillTx)}`);
        }
        else {
            fulfillTx = await client.fulfillOrder<ChainId.Ethereum>(order, {
                web3: createWeb3WithPrivateKey(fulfillableChainConfig.chainRpc, fulfillableChainConfig.wallet),
                fulfillAmount: Number(order.take.amount),
                permit: "0x",
            });
            logger.log(`matchProcessor fulfillTx is created in ${order.take.chainId} ${JSON.stringify(fulfillTx)}`);
        }

        let state = await client.getTakeOrderStatus(order, { web3: takeWeb3! });
        if (state === null) {
            throw new MarketMakerExecutorError(MarketMakerExecutorErrorType.OrderIsFulfilled);
        }//todo change to abort

        await sendTransaction(fulfillableChainConfig, fulfillTx);

        state = await client.getTakeOrderStatus(order, { web3: takeWeb3! });
        while (state === null || state.status !== OrderState.Fulfilled) {
            state = await client.getTakeOrderStatus(order, { web3: takeWeb3! });
            logger.log(`matchProcessor state=${JSON.stringify(state)}`);
            await helpers.sleep(2000);
        }

        let unlockTx;
        if (order.take.chainId === ChainId.Solana) {
            unlockTx = await client.sendUnlockOrder<ChainId.Solana>(order, fulfillableChainConfig.wallet!, executionFeeAmount, {
                unlocker: new PublicKey(fulfillableChainConfig.wallet),
            });
        } else {
            const rewards = order.give.chainId === ChainId.Solana ?
              {
                  reward1: fees.executionFees.rewards[0].toString(),
                  reward2: fees.executionFees.rewards[1].toString(),
              } : {
                  reward1: "0",
                  reward2: "0",
              }
            unlockTx = await client.sendUnlockOrder<ChainId.Polygon>(order, fulfillableChainConfig.beneficiary!, executionFeeAmount, {
                web3: createWeb3WithPrivateKey(fulfillableChainConfig.chainRpc, fulfillableChainConfig.wallet),
                ...rewards
            });
        }
        await sendTransaction(fulfillableChainConfig, unlockTx);
    }
}

/**
 * Represents an order fulfillment engine which swaps the given asset (inputToken) to a token
 * requested in the order
 */
export function preswapProcessor(inputToken: Address, slippage: number): (order: OrderData, executorConfig: ExecutorConfig, fulfillableChainConfig: FulfillableChainConfig, client: PMMClient) => Promise<void> {
    return async (order: OrderData, executorConfig: ExecutorConfig, fulfillableChainConfig: FulfillableChainConfig, client: PMMClient) => {
        let giveWeb3: Web3;
        if (order.give.chainId !== ChainId.Solana) {
            giveWeb3 = new Web3(fulfillableChainConfig!.chainRpc);
        }

        let takeWeb3: Web3;
        if (order.take.chainId !== ChainId.Solana) {
            takeWeb3 = new Web3(fulfillableChainConfig!.chainRpc);
        }

        const giveAddress = helpers.bufferToHex(Buffer.from(order.give.tokenAddress));
        const takeAddress = helpers.bufferToHex(Buffer.from(order.take.tokenAddress));

        const [giveNativePrice, takeNativePrice] = await Promise.all([
            executorConfig.priceTokenService!.getPrice(order.give.chainId, order.give.chainId !== ChainId.Solana ? evmNativeTokenAddress : solanaNativeTokenAddress),
            executorConfig.priceTokenService!.getPrice(order.take.chainId, order.take.chainId !== ChainId.Solana ? evmNativeTokenAddress : solanaNativeTokenAddress),
            executorConfig.priceTokenService!.getPrice(order.give.chainId, giveAddress),
            executorConfig.priceTokenService!.getPrice(order.take.chainId, takeAddress),
            client.getDecimals(order.give.chainId, giveAddress, giveWeb3!),
            client.getDecimals(order.take.chainId, takeAddress, takeWeb3!),
        ]);
        const fees = await client.getTakerFlowCost(order, giveNativePrice, takeNativePrice, { giveWeb3: giveWeb3!, takeWeb3: takeWeb3! });
        logger.log(`preswapProcessor fees=${JSON.stringify(fees)}`);

        const executionFeeAmount = await client.getAmountToSend(order.take.chainId, order.give.chainId, fees.executionFees.total, takeWeb3!);

        let fulfillTx;
        if (order.take.chainId === ChainId.Solana) {
            const wallet = new PublicKey(fulfillableChainConfig.wallet);
            fulfillTx = await client.preswapAndFulfillOrder<ChainId.Solana>(order, {
                taker: wallet,
                swapToken: inputToken as unknown as string,
            });
            logger.log(`preswapProcessor fulfillTx is created in solana ${JSON.stringify(fulfillTx)}`);
        }
        else {
            fulfillTx = await client.preswapAndFulfillOrder<ChainId.Ethereum>(order, {
                web3: createWeb3WithPrivateKey(fulfillableChainConfig.chainRpc, fulfillableChainConfig.wallet),
                fulfillAmount: Number(order.take.amount),
                permit: "0x",
                swapToken: inputToken as unknown as string,
                slippage: slippage,
                swapConnector: executorConfig.swapConnector!,
                takerAddress: fulfillableChainConfig.beneficiary,
                priceTokenService: executorConfig.priceTokenService!,
            });
            logger.log(`preswapProcessor fulfillTx is created in ${order.take.chainId} ${JSON.stringify(fulfillTx)}`);
        }
        let state = await client.getTakeOrderStatus(order, { web3: takeWeb3! });
        if (state === null) {
            throw new MarketMakerExecutorError(MarketMakerExecutorErrorType.OrderIsFulfilled);
        }

        await sendTransaction(fulfillableChainConfig, fulfillTx);

        state = await client.getTakeOrderStatus(order, { web3: takeWeb3! });
        while (state === null || state.status !== OrderState.Fulfilled) {
            state = await client.getTakeOrderStatus(order, { web3: takeWeb3! });
            logger.log(`preswapProcessor state=${JSON.stringify(state)}`);
            await helpers.sleep(2000);
        }

        let unlockTx;
        if (order.take.chainId === ChainId.Solana) {
            unlockTx = await client.sendUnlockOrder<ChainId.Solana>(order, fulfillableChainConfig.wallet!, executionFeeAmount, {
                unlocker: new PublicKey(fulfillableChainConfig.wallet),
            });
        } else {
            const rewards = order.give.chainId === ChainId.Solana ?
              {
                  reward1: fees.executionFees.rewards[0].toString(),
                  reward2: fees.executionFees.rewards[1].toString(),
              } : {
                  reward1: "0",
                  reward2: "0",
              }
            unlockTx = await client.sendUnlockOrder<ChainId.Polygon>(order, fulfillableChainConfig.beneficiary!, executionFeeAmount, {
                web3: createWeb3WithPrivateKey(fulfillableChainConfig.chainRpc, fulfillableChainConfig.wallet),
                ...rewards
            });
        }
        await sendTransaction(fulfillableChainConfig, unlockTx);
    }
}
