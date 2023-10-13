#!/usr/bin/env node

import { helpers } from '@debridge-finance/solana-utils';
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { config } from 'dotenv';
import bs58 from 'bs58';

config();

async function main() {
  const privateKey = process.env.SOLANA_TAKER_PRIVATE_KEY || '_';
  const versionedTx = VersionedTransaction.deserialize(helpers.hexToBuffer(process.argv[2]));
  const connection = new Connection(process.env.SOLANA_RPC!);
  const wallet = new helpers.Wallet(Keypair.fromSecretKey(bs58.decode(privateKey)));

  const [txid] = await helpers.sendAll(connection, wallet, versionedTx, {
    rpcCalls: 3,
    skipPreflight: false,
    logger: (...args: any) => console.log(...args), // sendAll will log base64 tx data sent to blockchain
  });

  console.log(txid);
}

main()
  .then(() => console.log('ALL DONE'))
  .catch((e) => console.error('ERROR', e));
