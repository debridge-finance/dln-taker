import { ChainId, ZERO_EVM_ADDRESS } from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";
import { Logger } from "pino";
import Web3 from "web3";

import { EvmAdapterProvider } from "../../providers/evm.provider.adapter";

import IERC20 from "./ierc20.json";

const APPROVE_VALUE =
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

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
    .approve(contractAddress, APPROVE_VALUE)
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

  return contract.methods.approve(contractAddress, APPROVE_VALUE).send(params);
};

export const isApproved = async (
  web3: Web3,
  tokenAddress: string,
  contractAddress: string
) => {
  if (contractAddress === ZERO_EVM_ADDRESS) return;
  const contract = new web3.eth.Contract(IERC20.abi as any, tokenAddress);

  const approvedCount = new BigNumber(
    await contract.methods
      .allowance(web3.eth.defaultAccount, contractAddress)
      .call()
  );

  return approvedCount.gt(0);
};

export const approveToken = async (
  chainId: ChainId,
  tokenAddress: string,
  contractAddress: string,
  provider: EvmAdapterProvider,
  logger: Logger
): Promise<void> => {
  if (chainId === ChainId.Solana) return Promise.resolve();
  const { connection } = provider;
  logger.debug(
    `Verifying approval given by ${provider.address} to ${contractAddress} to trade on ${tokenAddress} on ${ChainId[chainId]}`
  );
  const tokenIsApproved = await isApproved(
    connection,
    tokenAddress,
    contractAddress
  );
  if (!tokenIsApproved) {
    logger.debug(`Approving ${tokenAddress} on ${ChainId[chainId]}`);
    const tx = await approve(connection, tokenAddress, contractAddress);
    logger.debug(
      `Setting approval for ${tokenAddress} on ${ChainId[chainId]} succeeded`
    );
  } else {
    logger.debug(`${tokenAddress} already approved on ${ChainId[chainId]}`);
  }

  return Promise.resolve();
};
