import hre, { ethers } from 'hardhat';
import { expect } from 'chai';
import { Logger } from 'pino';
import '@nomiclabs/hardhat-web3';
import * as hh from '@nomicfoundation/hardhat-network-helpers';
import { TransactionBroadcaster } from './broadcaster';
import { EvmFeeManager, LegacyGasExtension } from '../fees/manager';
import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-chai-matchers';
import { Account, createTestFrameworkLogger, getWeb3Accounts } from '../../../tests/helpers/index';
import { GasCategory } from '../fees/types';
import { TickTockABI, TickTockByteCode } from './broadcaster.test.utils';

declare module 'mocha' {
  interface Context {
    signer: Account;
    recipient: Account;
    logger: Logger;
    tx: {
      from: string;
      data: string;
      to: string;
      value: string;
    };
    amount: BigInt;
  }
}

async function expectSuccessfulBroadcast(
  broadcaster: TransactionBroadcaster,
  expectedNonce: number,
) {
  const receiptPromise = broadcaster.broadcastAndWait();
  await expect(receiptPromise).to.not.rejected;

  const { transactionHash } = await receiptPromise;
  const tx = await hre.web3.eth.getTransaction(transactionHash);
  expect(tx.nonce).to.eq(expectedNonce);

  const receipt = await hre.web3.eth.getTransactionReceipt(transactionHash);
  expect(receipt.status).to.eq(true);

  return { tx, receipt };
}

describe(`Broadcaster`, function () {
  beforeEach(async () => {
    await hh.reset();

    // setup web3 wallet
    const [signer, recipient] = await getWeb3Accounts();
    this.ctx.signer = signer;
    this.ctx.recipient = recipient;
    hre.web3.eth.accounts.wallet.add(signer);
    hre.web3.eth.defaultAccount = signer.address;

    // logger
    this.ctx.logger = createTestFrameworkLogger();

    // setup transaction
    // amount is a whole balance minus 0.01 ETH (for fees)
    this.ctx.amount = BigInt(await hre.web3.eth.getBalance(signer.address)) - 10n ** 18n;
    this.ctx.tx = {
      from: signer.address,
      to: recipient.address,
      data: '0x',
      value: this.ctx.amount.toString(),
    };
  });

  it('Must accept transaction immediately', async () => {
    // amount is a whole balance minus 0.01 ETH (for fees)
    const broadcaster = new TransactionBroadcaster(
      this.ctx.tx,
      undefined,
      hre.web3,
      new EvmFeeManager(hre.network.config.chainId || 1, hre.web3, {}, {}, true),
      async (tx) => (await this.ctx.signer.signTransaction(tx)).rawTransaction || '0x',
      this.ctx.logger,
    );

    await expect(async () =>
      hre.ethers.provider.getTransaction((await broadcaster.broadcastAndWait()).transactionHash),
    ).to.changeEtherBalances(
      [this.ctx.signer.address, this.ctx.recipient.address],
      [-this.ctx.amount, this.ctx.amount],
    );
  });

  it('Must be rejected upon sending', async () => {
    const { logger, signer } = this.ctx;

    await hh.setBalance(signer.address, 1);

    const sender = new TransactionBroadcaster(
      this.ctx.tx,
      undefined,
      hre.web3,
      new EvmFeeManager(hre.network.config.chainId || 1, hre.web3, {}, {}, true),
      async (tx) => (await signer.signTransaction(tx)).rawTransaction || '0x',
      logger,
      {
        pollingIntervalMs: 10,
        pollingMaxAttempts: 5,
      },
    );

    await expect(sender.broadcastAndWait()).to.be.rejectedWith(
      `sender doesn't have enough funds to send tx`,
    );
  });

  it('Must return a receipt of an included txn that gets reverted', async () => {
    //
    // Deploy TickTock
    //
    const [, deployer, greedyGuy] = await hre.ethers.getSigners();

    // using hre.ethers.getContractFactory(abi, bytecode, signer); gives us an object without deploy() function
    const TickTock = new ethers.ContractFactory(TickTockABI, TickTockByteCode, deployer);
    const tickTock = await TickTock.deploy();
    const receiptDeploy = await hre.web3.eth.getTransactionReceipt(
      tickTock.deploymentTransaction()!.hash,
    );
    expect(receiptDeploy.status).to.eq(true, 'TickTock failed to deploy');
    const tickTockAddress = await tickTock.getAddress();

    await greedyGuy.sendTransaction({
      to: tickTockAddress,
      data: tickTock.interface.encodeFunctionData('set', [true]),
      gasPrice: BigInt(await hre.web3.eth.getGasPrice()) * 10n,
    });

    //
    // Pause mining to aggregate txns in the mempool
    //
    await hre.ethers.provider.send('evm_setAutomine', [false]);

    //
    // Do the test
    //
    const { logger, signer } = this.ctx;

    const guessTxToBeMEVed = {
      from: signer.address,
      to: tickTockAddress,
      data: tickTock.interface.encodeFunctionData('guess', [true]),
      gas: 1e6,
    };

    const sender = new TransactionBroadcaster(
      guessTxToBeMEVed,
      undefined,
      hre.web3,
      new EvmFeeManager(hre.network.config.chainId || 1, hre.web3, {}, {}, true),
      async (tx) => {
        setTimeout(async () => {
          const injectedTx = await greedyGuy.sendTransaction({
            to: tickTockAddress,
            data: tickTock.interface.encodeFunctionData('set', [false]),
            gasPrice: BigInt(await hre.web3.eth.getGasPrice()) * 10n,
          });
          logger.debug('enabling mining');
          await hre.ethers.provider.send('evm_mine');

          logger.debug(`injected tx: ${(await injectedTx.wait())?.hash}`);
        }, 25);

        return (await signer.signTransaction(tx)).rawTransaction || '0x';
      },
      logger,
      {
        pollingIntervalMs: 10,
        pollingMaxAttempts: 5,
        sendMaxAttempts: 1,
      },
    );

    const receipt = await sender.broadcastAndWait();
    expect(receipt.status).to.eq(false);
  });

  it('Must return the receipt of a previously stuck txn that is finally included and reverted before a replacement txn is broadcasted', async () => {
    // This test is necessary to ensure a tricky edge case when a transaction #1 gets stuck,
    // but is included and (sic!) reverted after the polling is stopped but before
    // a replacement transaction #2 gets broadcasted. Obviously, if #1 is finally included,
    // #2 won't be accepted by the RPC (triggering a broadcast rejection error),
    // so the expected behaviour would be that the broadcaster goes over all previous
    // unconfirmed broadcasts to find a confirmed one (even in status=0x0, which is what we check)

    // This edge case can't be reproduced with corrupting state: for example, initially I wanted
    // to create a transaction that withdraws ether from a contract, and after it gets accepted
    // into the mempool (but before it gets mined) nullify that contract's balance by calling
    // hh.setBalance(contractAddress, 0) and immediately after that triggering mine operation.
    // However, this didn't work, the transaction gets included succesfully.

    // That's why this test uses mempool transaction ordering to inject a transaction that
    // "steals" the ability of "our" transaction to succeed. For this purpose, a TickTock contract
    // is used: "our" transaction calls a guess(v) contract method which succeeds if the "v" value
    // equals to contract storage variable; otherwise, the call gets reverted. "Our" transaction
    // is crafted having the "v" variable to equal to the current state, but before it gets mined,
    // greedy transaction is pulled to the mempool with enlarged gasPrice and a call that changes
    // the state of the contract. Next, a mining is enabled, effectively leading a greeady transaction
    // to be executed first, and our transaction to be the second (and thus revert).

    //
    // Deploy TickTock
    //
    const [, deployer, greedyGuy] = await hre.ethers.getSigners();

    // using hre.ethers.getContractFactory(abi, bytecode, signer); gives us an object without deploy() function
    const TickTock = new ethers.ContractFactory(TickTockABI, TickTockByteCode, deployer);
    const tickTock = await TickTock.deploy();
    const receiptDeploy = await hre.web3.eth.getTransactionReceipt(
      tickTock.deploymentTransaction()!.hash,
    );
    expect(receiptDeploy.status).to.eq(true, 'TickTock failed to deploy');
    const tickTockAddress = await tickTock.getAddress();

    await greedyGuy.sendTransaction({
      to: tickTockAddress,
      data: tickTock.interface.encodeFunctionData('set', [true]),
      gasPrice: BigInt(await hre.web3.eth.getGasPrice()) * 10n,
    });

    //
    // Pause mining to aggregate txns in the mempool
    //
    await hre.ethers.provider.send('evm_setAutomine', [false]);

    //
    // Do the test
    //
    const { logger, signer } = this.ctx;

    const guessTxToBeMEVed = {
      from: signer.address,
      to: tickTockAddress,
      data: tickTock.interface.encodeFunctionData('guess', [true]),
      gas: 1e6,
    };

    let attempt = 0;

    const sender = new TransactionBroadcaster(
      guessTxToBeMEVed,
      undefined,
      hre.web3,
      new EvmFeeManager(hre.network.config.chainId || 1, hre.web3, {}, {}, true),
      async (tx) => {
        attempt++;

        if (attempt === 2) {
          const injectedTx = await greedyGuy.sendTransaction({
            to: tickTockAddress,
            data: tickTock.interface.encodeFunctionData('set', [false]),
            gasPrice: BigInt(await hre.web3.eth.getGasPrice()) * 10n,
          });
          logger.debug('enabling mining');
          await hre.ethers.provider.send('evm_mine');
          await hre.ethers.provider.send('evm_setAutomine', [true]);

          logger.debug(`injected tx: ${(await injectedTx.wait())?.hash}`);
        }

        return (await signer.signTransaction(tx)).rawTransaction || '0x';
      },
      logger,
      {
        pollingIntervalMs: 10,
        pollingMaxAttempts: 5,
        sendMaxAttempts: 3,
      },
    );

    const receipt = await sender.broadcastAndWait();
    expect(receipt.status).to.eq(false);
  });

  it('Must broadcast transaction w/increased nonce when nonce is too low', async () => {
    const { logger, signer } = this.ctx;

    let nonceInjected = false;
    const broadcaster = new TransactionBroadcaster(
      this.ctx.tx,
      undefined,
      hre.web3,
      new EvmFeeManager(hre.network.config.chainId || 1, hre.web3),
      async (tx) => {
        if (!nonceInjected) {
          nonceInjected = true;

          const injectedTx = await hre.web3.eth.sendTransaction({
            to: this.ctx.recipient.address,
            value: 1,
            gas: 21000,
          });

          logger.debug(`injected: ${injectedTx.transactionHash}`);
          expect(await hre.web3.eth.getTransactionCount(signer.address)).to.eq(1);
        }

        return (await signer.signTransaction(tx)).rawTransaction || '0x';
      },
      logger,
    );

    await expectSuccessfulBroadcast(broadcaster, 1);
  });

  it('Must replace transaction when it is underpriced', async () => {
    const { logger, signer } = this.ctx;

    // we must ensure that the blockchain accepted our final txn (with normal gas)
    let lastRecordedGasPrice: BigInt;

    // we must ensure that the Broadcaster succeeded at the last attempt (not earlier or later)
    let feeFetchingAttempt = 0;
    const mockSuccessfulAttempt = 2;
    const sendMaxAttempts = 3;

    const sender = new TransactionBroadcaster(
      this.ctx.tx,
      undefined,
      hre.web3,
      new EvmFeeManager(
        hre.network.config.chainId || 1,
        hre.web3,
        {},
        {
          legacyFeeFetcher: async (gasCategory, connection) => {
            feeFetchingAttempt++;
            if (feeFetchingAttempt === sendMaxAttempts) {
              expect(gasCategory).to.eq(
                GasCategory.AGGRESSIVE,
                'last attempt must force aggressive gas category',
              );
            }
            const gasPrice = BigInt(await connection.eth.getGasPrice());
            if (feeFetchingAttempt !== mockSuccessfulAttempt) {
              const reducedGasPrice = gasPrice / 10n;
              return reducedGasPrice;
            }
            lastRecordedGasPrice = gasPrice;
            return gasPrice;
          },
        },
        true,
      ),
      async (tx) => (await signer.signTransaction(tx)).rawTransaction || '0x',
      logger,
      {
        sendMaxAttempts,
      },
    );

    const { tx } = await expectSuccessfulBroadcast(sender, 0);
    expect(tx.gasPrice).to.eq(lastRecordedGasPrice!);

    expect(feeFetchingAttempt).to.eq(mockSuccessfulAttempt);
  });

  it('Must replace transaction when it is underpriced (last attempt only)', async () => {
    const { logger, signer } = this.ctx;

    // we must ensure that the blockchain accepted our final txn (with normal gas)
    let lastRecordedGasPrice: BigInt;

    // we must ensure that the Broadcaster succeeded at the last attempt (not earlier or later)
    let feeFetchingAttempt = 0;
    const mockSuccessfulAttempt = 3;
    const sendMaxAttempts = 3;

    const sender = new TransactionBroadcaster(
      this.ctx.tx,
      undefined,
      hre.web3,
      new EvmFeeManager(
        hre.network.config.chainId || 1,
        hre.web3,
        {},
        {
          legacyFeeFetcher: async (gasCategory, connection) => {
            feeFetchingAttempt++;
            if (feeFetchingAttempt === sendMaxAttempts) {
              expect(gasCategory).to.eq(
                GasCategory.AGGRESSIVE,
                'last attempt must force aggressive gas category',
              );
            }
            const gasPrice = BigInt(await connection.eth.getGasPrice());
            if (feeFetchingAttempt !== mockSuccessfulAttempt) {
              const reducedGasPrice = gasPrice / 10n;
              return reducedGasPrice;
            }
            lastRecordedGasPrice = gasPrice;
            return gasPrice;
          },
        },
        true,
      ),
      async (tx) => (await signer.signTransaction(tx)).rawTransaction || '0x',
      logger,
      {
        sendMaxAttempts,
      },
    );

    const { tx } = await expectSuccessfulBroadcast(sender, 0);
    expect(tx.gasPrice).to.eq(lastRecordedGasPrice!);

    expect(feeFetchingAttempt).to.eq(mockSuccessfulAttempt);
  });

  it('Must replace transaction when it is stuck', async () => {
    const { logger, signer } = this.ctx;

    await hre.ethers.provider.send('evm_setAutomine', [false]);
    let expectedTxToBeIncluded: LegacyGasExtension;
    let signingAttempt = 0;
    const mockSuccessfulAttempt = 2;
    const sendMaxAttempts = 3;

    const sender = new TransactionBroadcaster(
      this.ctx.tx,
      undefined,
      hre.web3,
      new EvmFeeManager(hre.network.config.chainId || 1, hre.web3, {}, {}, true),
      async (tx) => {
        signingAttempt++;
        if (signingAttempt === mockSuccessfulAttempt) {
          expectedTxToBeIncluded = <LegacyGasExtension>tx;
          setTimeout(async () => {
            logger.debug('enabling mining');
            await hre.ethers.provider.send('evm_mine');
          }, 25);
        }
        return (await signer.signTransaction(tx)).rawTransaction || '0x';
      },
      logger,
      {
        pollingIntervalMs: 10,
        pollingMaxAttempts: 5,
        sendMaxAttempts,
      },
    );

    const { tx } = await expectSuccessfulBroadcast(sender, 0);

    // ensure that the first transaction was actually included!
    expect(tx.gasPrice).to.eq(expectedTxToBeIncluded!.gasPrice);

    expect(signingAttempt).to.eq(mockSuccessfulAttempt);
  });

  it('Must replace transaction when it is stuck (last attempt only)', async () => {
    const { logger, signer } = this.ctx;

    await hre.ethers.provider.send('evm_setAutomine', [false]);
    let expectedTxToBeIncluded: LegacyGasExtension;
    let signingAttempt = 0;
    const mockSuccessfulAttempt = 3;
    const sendMaxAttempts = 3;

    const sender = new TransactionBroadcaster(
      this.ctx.tx,
      undefined,
      hre.web3,
      new EvmFeeManager(hre.network.config.chainId || 1, hre.web3, {}, {}, true),
      async (tx) => {
        signingAttempt++;
        if (signingAttempt === mockSuccessfulAttempt) {
          expectedTxToBeIncluded = <LegacyGasExtension>tx;
          setTimeout(async () => {
            logger.debug('enabling mining');
            await hre.ethers.provider.send('evm_mine');
          }, 25);
        }
        return (await signer.signTransaction(tx)).rawTransaction || '0x';
      },
      logger,
      {
        pollingIntervalMs: 10,
        pollingMaxAttempts: 5,
        sendMaxAttempts,
      },
    );

    const { tx } = await expectSuccessfulBroadcast(sender, 0);

    // ensure that the first transaction was actually included!
    expect(tx.gasPrice).to.eq(expectedTxToBeIncluded!.gasPrice);

    expect(signingAttempt).to.eq(mockSuccessfulAttempt);
  });

  it('Must pick successful txn if replacement txn gets rejected', async () => {
    const { logger, signer } = this.ctx;

    await hre.ethers.provider.send('evm_setAutomine', [false]);
    let signingAttempt = 0;
    let expectedTxToBeIncluded: LegacyGasExtension;
    const mockSuccessfulAttempt = 2;
    const sendMaxAttempts = 3;

    const sender = new TransactionBroadcaster(
      this.ctx.tx,
      undefined,
      hre.web3,
      new EvmFeeManager(hre.network.config.chainId || 1, hre.web3, {}, {}, true),
      async (tx) => {
        signingAttempt++;
        if (signingAttempt === mockSuccessfulAttempt) {
          logger.debug('enabling mining');
          await hre.ethers.provider.send('evm_mine');
        }
        if (signingAttempt + 1 === mockSuccessfulAttempt) {
          expectedTxToBeIncluded = <LegacyGasExtension>tx;
        }
        return (await signer.signTransaction(tx)).rawTransaction || '0x';
      },
      logger,
      {
        pollingIntervalMs: 10,
        pollingMaxAttempts: 5,
        sendMaxAttempts,
      },
    );

    const { tx } = await expectSuccessfulBroadcast(sender, 0);

    // ensure that the first transaction was actually included!
    expect(tx.gasPrice).to.eq(expectedTxToBeIncluded!.gasPrice);

    expect(signingAttempt).to.eq(mockSuccessfulAttempt);
  });

  it('Must pick successful txn if replacement txn gets rejected (last attempt only)', async () => {
    const { logger, signer } = this.ctx;

    await hre.ethers.provider.send('evm_setAutomine', [false]);
    let signingAttempt = 0;
    let expectedTxToBeIncluded: LegacyGasExtension;
    const mockSuccessfulAttempt = 3;
    const sendMaxAttempts = 3;

    const sender = new TransactionBroadcaster(
      this.ctx.tx,
      undefined,
      hre.web3,
      new EvmFeeManager(hre.network.config.chainId || 1, hre.web3, {}, {}, true),
      async (tx) => {
        signingAttempt++;
        if (signingAttempt + 1 === mockSuccessfulAttempt) {
          expectedTxToBeIncluded = <LegacyGasExtension>tx;
        }
        if (signingAttempt === mockSuccessfulAttempt) {
          logger.debug('enabling mining');
          await hre.ethers.provider.send('evm_mine');
        }
        return (await signer.signTransaction(tx)).rawTransaction || '0x';
      },
      logger,
      {
        pollingIntervalMs: 10,
        pollingMaxAttempts: 5,
        sendMaxAttempts,
      },
    );

    const { tx } = await expectSuccessfulBroadcast(sender, 0);

    // ensure that the previous transaction was actually included!
    expect(tx.gasPrice).to.eq(expectedTxToBeIncluded!.gasPrice);

    expect(signingAttempt).to.eq(mockSuccessfulAttempt);
  });

  xit('TODO Must reject txn if capped fee is reached');
});
