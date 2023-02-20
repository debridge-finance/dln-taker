import { ChainId, ZERO_EVM_ADDRESS } from "@debridge-finance/dln-client";
import BigNumber from "bignumber.js";
import { Logger } from "pino";
import Web3 from "web3";

import { EvmProviderAdapter } from "../../providers/evm.provider.adapter";

import IERC20 from "./ierc20.json";

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
  provider: EvmProviderAdapter,
  logger: Logger
): Promise<void> => {
  if (chainId === ChainId.Solana) return Promise.resolve();
  const { connection } = provider;
  logger.debug(
    `Verifying approval given by ${provider.address} to ${contractAddress} to trade on ${tokenAddress} on ${ChainId[chainId]}`
  );
  if (tokenAddress == '0x0000000000000000000000000000000000000000') {
    return Promise.resolve();
  }
  const tokenIsApproved = await isApproved(
    connection,
    tokenAddress,
    contractAddress
  );
  if (!tokenIsApproved) {
    logger.debug(`Approving ${tokenAddress} on ${ChainId[chainId]}`);
    const data = approve(connection, tokenAddress, contractAddress);
    await provider.sendTransaction(data, { logger });
    logger.debug(
      `Setting approval for ${tokenAddress} on ${ChainId[chainId]} succeeded`
    );
  } else {
    logger.debug(`${tokenAddress} already approved on ${ChainId[chainId]}`);
  }

  return Promise.resolve();
};
