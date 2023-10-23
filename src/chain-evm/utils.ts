import Web3 from 'web3';

export function isValidEvmAddress(address: string) {
  if (!address.startsWith('0x')) {
    return false;
  }
  return new Web3().utils.isAddress(address.toLowerCase());
}
