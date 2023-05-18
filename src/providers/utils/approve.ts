import {  ZERO_EVM_ADDRESS } from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";
import Web3 from "web3";

import IERC20 from "../../processors/utils/ierc20.json";


const APPROVE_VALUE =
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

export const approve = (
  web3: Web3,
  tokenAddress: string,
  contractAddress: string
) => {
  if (contractAddress === ZERO_EVM_ADDRESS) return;
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
) => {
  if (contractAddress === ZERO_EVM_ADDRESS) return;
  const contract = new connection.eth.Contract(IERC20.abi as any, tokenAddress);

  const approvedCount = new BigNumber(
    await contract.methods
      .allowance(address, contractAddress)
      .call()
  );

  return approvedCount.gt(0);
};

