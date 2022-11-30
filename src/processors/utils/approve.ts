import Web3 from "web3";
import IERC20 from "./ierc20.json";
import { ChainId, ZERO_EVM_ADDRESS } from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";
import { EvmAdapterProvider } from "../../providers/evm.provider.adapter";
import { OrderProcessorInitContext } from "../order.processor";

const APPROVE_VALUE = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

export const approve = async (
  web3: Web3,
  tokenAddress: string,
  contractAddress: string
) => {
  if (contractAddress === ZERO_EVM_ADDRESS) return;
  const contract = new web3.eth.Contract(IERC20.abi as any, tokenAddress);
  const from = web3.eth.defaultAccount;
  const gasPrice = await web3.eth.getGasPrice();
  const gas = await contract.methods
    .approve(
      contractAddress,
      APPROVE_VALUE
    )
    .estimateGas({
      from,
      value: 0,
    });

  const params = {
    from,
    to: tokenAddress,
    gasPrice,
    gas,
  };

  return contract.methods
    .approve(
      contractAddress,
      APPROVE_VALUE
    )
    .send(params);
};


export const isApproved = async (
  web3: Web3,
  tokenAddress: string,
  contractAddress: string
) => {
  if (contractAddress === ZERO_EVM_ADDRESS) return;
  const contract = new web3.eth.Contract(IERC20.abi as any, tokenAddress);

  const approvedCount = new BigNumber(await contract.methods.allowance
    (
      web3.eth.defaultAccount,
      contractAddress,
    )
    .call());

  return approvedCount.gt(0);
};

export const approveToken = async (chainId: ChainId, tokenAddress: string, contractAddress: string, context: OrderProcessorInitContext): Promise<void> => {
  if (chainId === ChainId.Solana) return Promise.resolve();
  const { connection } = context.providersForFulfill.get(chainId) as EvmAdapterProvider;
  const tokenIsApproved = await isApproved(connection, tokenAddress, contractAddress);
  if (!tokenIsApproved) {
    context.logger.debug(`Token ${tokenAddress} approving is started`);
    await approve(connection, tokenAddress, contractAddress);
    context.logger.debug(`Token ${tokenAddress} approving is finished`);
  } else {
    context.logger.debug(`Token ${tokenAddress} is approved`);
  }

  return Promise.resolve();
}
