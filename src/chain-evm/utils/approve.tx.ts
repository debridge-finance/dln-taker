import Web3 from 'web3';
import IERC20 from './ierc20.json';
import { InputTransaction } from '../signer';

const MAX_UINT256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

export function getApproveTx(tokenAddress: string, spenderAddress: string): InputTransaction {
  const contract = new new Web3().eth.Contract(IERC20.abi as any, tokenAddress);

  return {
    to: tokenAddress,
    data: contract.methods.approve(spenderAddress, MAX_UINT256).encodeABI(),
  };
}

export async function getAllowance(
  connection: Web3,
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
): Promise<bigint> {
  const contract = new connection.eth.Contract(IERC20.abi as any, tokenAddress);

  const approvedAmount = (await contract.methods
    .allowance(ownerAddress, spenderAddress)
    .call()) as string;

  return BigInt(approvedAmount);
}
