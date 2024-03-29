/* eslint-disable import/no-extraneous-dependencies,import/no-default-export -- only for testing purposes */
import { HardhatUserConfig } from 'hardhat/config';
import '@nomiclabs/hardhat-web3';
import '@nomicfoundation/hardhat-chai-matchers';
import '@nomicfoundation/hardhat-ethers';

const config: HardhatUserConfig = {
  solidity: '0.8.19',
  defaultNetwork: process.env.TEST_AGAINST_LOCAL_NODE === 'true' ? 'localhost' : undefined,
};
export default config;
