import Web3 from "web3";

const web3HttpTimeout = parseInt(process.env.WEB_HTTP_TIMEOUT || '') || 60 * 1000; //1min

export function createWeb3WithPrivateKey(rpc: string, privateKey: string) {
  const web3 = new Web3(new Web3.providers.HttpProvider(rpc, {
    timeout: web3HttpTimeout,
  }));
  const accountEvmFromPrivateKey =
    web3.eth.accounts.privateKeyToAccount(privateKey);
  web3.eth.accounts.wallet.add(accountEvmFromPrivateKey);
  web3.eth.defaultAccount = accountEvmFromPrivateKey.address;

  return web3;
}
