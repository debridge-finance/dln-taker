import Web3 from "web3";
import {ZERO_EVM_ADDRESS} from "@debridge-finance/pmm-client";
import IERC20 from "./IERC20.json";


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
