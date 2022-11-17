import { ChainId, ZERO_EVM_ADDRESS } from "@debridge-finance/pmm-client";
import { helpers } from "@debridge-finance/solana-utils";
import {
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import Web3 from "web3";

import { ChainConfig } from "../../config";

import { createWeb3WithPrivateKey } from "./create.web3.with.private.key";
import IERC20 from "./ierc20.json";

function isTransactionInstruction(arg: unknown): arg is TransactionInstruction {
  const data = arg as Record<string, unknown>;
  return "programId" in data && "data" in data && "keys" in data;
}

function isTransaction(arg: unknown): arg is Transaction {
  const data = arg as Record<string, unknown>;
  return "instructions" in data && "signature" in data;
}

function isVersionedTransaction(arg: unknown): arg is VersionedTransaction {
  const data = arg as Record<string, unknown>;

  return "message" in data && "version" in data;
}

const sendSolanaTransaction = async (
  solanaConnection: Connection,
  keypair: Keypair,
  data: unknown
): Promise<string> => {
  let tx: Transaction | VersionedTransaction;
  if (isTransactionInstruction(data)) {
    tx = new Transaction().add(data);
  } else if (isTransaction(data)) {
    tx = data;
  } else if (isVersionedTransaction(data)) {
    tx = data;
  } else {
    throw new Error(
      "Don't know how to handle this input. It's not Transaction, VersionedTransaction or TransactionInstruction"
    );
  }
  const wallet = new helpers.Wallet(keypair);
  const txid = await helpers.sendAll(
    solanaConnection,
    wallet,
    [tx],
    undefined,
    undefined,
    false,
    true
  );
  return txid[0];
};

const sendEvmTransaction = async (
  web3: Web3,
  data: unknown
): Promise<string> => {
  const tx = data as { data: string; to: string; value: number };
  const gasLimit = await web3.eth.estimateGas(tx);
  const gasPrice = await web3.eth.getGasPrice();
  const result = await web3.eth.sendTransaction({
    ...tx,
    from: web3.eth.defaultAccount!,
    gasPrice,
    gas: gasLimit,
  });
  return result.transactionHash;
};

export const sendTransaction = async (
  fulfillableChainConfig: ChainConfig,
  data: unknown
): Promise<string> => {
  if (fulfillableChainConfig.chain === ChainId.Solana) {
    const solanaConnection = new Connection(fulfillableChainConfig.chainRpc);
    const keyPair = Keypair.fromSecretKey(
      helpers.hexToBuffer(fulfillableChainConfig.takerPrivateKey)
    );
    return sendSolanaTransaction(solanaConnection, keyPair, data);
  } else {
    const web3 = await createWeb3WithPrivateKey(
      fulfillableChainConfig.chainRpc,
      fulfillableChainConfig.takerPrivateKey
    );
    return sendEvmTransaction(web3, data);
  }
};

export const approve = async (
  web3: Web3,
  account: string | null,
  tokenAddress: string,
  contractAddress: string
) => {
  if (contractAddress === ZERO_EVM_ADDRESS) return;
  const contract = new web3.eth.Contract(IERC20.abi as any, tokenAddress);
  const gasPrice = await web3.eth.getGasPrice();
  const gas = await contract.methods
    .approve(
      contractAddress,
      "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    )
    .estimateGas({
      from: account,
      value: 0,
    });

  const params = {
    from: account,
    to: tokenAddress,
    gasPrice,
    gas,
  };

  return contract.methods
    .approve(
      contractAddress,
      "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    )
    .send(params);
};
