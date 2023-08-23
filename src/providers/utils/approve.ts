import {  ZERO_EVM_ADDRESS } from "@debridge-finance/dln-client";
import Web3 from "web3";

import IERC20 from "../../processors/utils/ierc20.json";


const APPROVE_VALUE =
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

type ApproveTx = {
  to :string,
  data: string
}

export const approve = (
  web3: Web3,
  tokenAddress: string,
  contractAddress: string
): undefined | ApproveTx => {
  if (contractAddress === ZERO_EVM_ADDRESS) return undefined;
  const contract = new web3.eth.Contract(IERC20.abi as any, tokenAddress);

  return {
    to: tokenAddress,
    data: contract.methods.approve(contractAddress, APPROVE_VALUE).encodeABI(),
  };
};

export const isApproved = async (
    connection: Web3,
    address: string,
    tokenAddress: string,
    contractAddress: string
): Promise<boolean | undefined> => {
  if (contractAddress === ZERO_EVM_ADDRESS) return undefined;
  const contract = new connection.eth.Contract(IERC20.abi as any, tokenAddress);

  const approvedCount: string = await contract.methods
    .allowance(address, contractAddress)
    .call() as string;

  return approvedCount !== '0';
};

