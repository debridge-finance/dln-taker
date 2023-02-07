import Web3 from "web3";

const balanceOfABI = [
  {
    constant: true,
    inputs: [
      {
        name: "_owner",
        type: "address",
      },
    ],
    name: "balanceOf",
    outputs: [
      {
        name: "balance",
        type: "uint256",
      },
    ],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
] as any;

export const getEvmAccountBalance = async (
  web3: Web3,
  tokenContract: string,
  address: string
) => {
  let result;
  if (!tokenContract) {
    result = await web3.eth.getBalance(address);
  } else {
    const contract = new web3.eth.Contract(balanceOfABI, tokenContract);
    result = await contract.methods.balanceOf(address).call();
  }

  return result;
};
