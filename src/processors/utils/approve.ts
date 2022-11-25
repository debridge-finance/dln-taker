import Web3 from "web3";
import IERC20 from "./ierc20.json";
import { ZERO_EVM_ADDRESS } from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";

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

