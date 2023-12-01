import { buffersAreEqual, ChainId } from '@debridge-finance/dln-client';
import { Logger } from 'pino';
import Web3 from 'web3';
import { IExecutor } from '../../executor';
import { InputTransaction } from '../signer';
import IERC20 from './ierc20.json';

const MAX_UINT256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

function getApproveTx(tokenAddress: string, spenderAddress: string): InputTransaction {
  const contract = new new Web3().eth.Contract(IERC20.abi as any, tokenAddress);

  return {
    to: tokenAddress,
    data: contract.methods.approve(spenderAddress, MAX_UINT256).encodeABI(),
  };
}

async function getAllowance(
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

type ApprovalTxDetails = {
  token: string;
  spender: string;
  tx: InputTransaction;
};

export async function createERC20ApproveTxs(
  chain: ChainId,
  contractsForApprove: string[],
  connection: Web3,
  signer: string,
  executor: IExecutor,
  logger: Logger,
): Promise<Array<ApprovalTxDetails>> {
  const txns: Array<ApprovalTxDetails> = [];

  logger.debug('Collect ERC-20 tokens that should have approvals');
  const tokens: string[] = [];
  for (const bucket of executor.buckets) {
    for (const token of bucket.findTokens(chain) || []) {
      if (!buffersAreEqual(token, Buffer.alloc(20, 0))) {
        tokens.push(token.toAddress(chain));
      }
    }
  }

  for (const token of tokens) {
    for (const contract of contractsForApprove) {
      // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
      const currentAllowance = await getAllowance(connection, token, signer, contract);
      if (currentAllowance === 0n) {
        logger.debug(`${token} requires approval`);
        logger.info(
          `Creating a txn to set ∞ approval on ${token} to be spend by ${contract} on behalf of a ${signer}`,
        );
        txns.push({
          token,
          spender: contract,
          tx: getApproveTx(token, contract),
        });
      } else {
        logger.info(
          `Allowance found (${currentAllowance}) on ${token} to be spend by ${contract} on behalf of a ${signer}`,
        );
      }
    }
  }
  return txns;
}
