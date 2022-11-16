import {Connection, Keypair, Transaction, TransactionInstruction} from "@solana/web3.js";
import {helpers} from "@debridge-finance/solana-utils";
import Web3 from "web3";
import {ChainId, ZERO_EVM_ADDRESS} from "@debridge-finance/pmm-client";
import {createWeb3WithPrivateKey} from "./create.web3.with.private.key";
import IERC20 from "./ierc20.json";
import {ChainConfig} from "../../config";

const sendSolanaTransaction = async (solanaConnection: Connection, keypair: Keypair, data: unknown): Promise<string> => {
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
  return txid[0];
}

const sendEvmTransaction = async (web3: Web3, data: unknown): Promise<string> => {
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
}


export const sendTransaction = async (fulfillableChainConfig: ChainConfig, data: unknown): Promise<string> => {
  if (fulfillableChainConfig.chain === ChainId.Solana) {
    const solanaConnection = new Connection(fulfillableChainConfig.chainRpc);
    const keyPair = Keypair.fromSecretKey(helpers.hexToBuffer(fulfillableChainConfig.wallet));
    return  sendSolanaTransaction(solanaConnection, keyPair, data);
  } else {
    const web3 = await createWeb3WithPrivateKey(fulfillableChainConfig.chainRpc, fulfillableChainConfig.wallet);
    return sendEvmTransaction(web3, data);
  }
}

export const approve = async (web3: Web3, account: string | null, tokenAddress: string, contractAddress: string) => {
  if (contractAddress === ZERO_EVM_ADDRESS) return ;
  const contract = new web3.eth.Contract(IERC20.abi as any, tokenAddress);
  const gasPrice = await web3.eth.getGasPrice();
  const gas = await contract.methods
    .approve(contractAddress, "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
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
    .approve(contractAddress, "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
    .send(params);
};
