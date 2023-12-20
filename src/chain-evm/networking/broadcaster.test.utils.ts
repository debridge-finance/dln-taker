// pragma solidity ^0.8.7;
//
// contract TickTock {
//     bool isTock;
//
//     function set(bool flag) external {
//         isTock = flag;
//     }
//
//     function guess(bool value) external {
//         require(isTock == value, 'wrong guess');
//     }
// }

export const TickTockABI = [
  {
    inputs: [
      {
        internalType: 'bool',
        name: 'value',
        type: 'bool',
      },
    ],
    name: 'guess',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bool',
        name: 'flag',
        type: 'bool',
      },
    ],
    name: 'set',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export const TickTockByteCode =
  '0x608060405234801561001057600080fd5b50610162806100206000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c80635f76f6ab1461003b578063e0a8f09a1461007c575b600080fd5b61007a610049366004610103565b600080547fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0016911515919091179055565b005b61007a61008a366004610103565b60005460ff16151581151514610100576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152600b60248201527f77726f6e67206775657373000000000000000000000000000000000000000000604482015260640160405180910390fd5b50565b60006020828403121561011557600080fd5b8135801515811461012557600080fd5b939250505056fea2646970667358221220383f4cd3edfbe6deba0940ea783e6ff9a84493373a93732bf6e3d48a947eb42764736f6c63430008070033';
