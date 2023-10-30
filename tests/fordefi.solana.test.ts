import { VersionedTransaction, clusterApiUrl, Connection } from '@solana/web3.js';
import { SolanaForDefiConverter } from 'src/chain-solana/fordefi-converter';

describe('Can convert versioned tx into fordefi format', () => {
  const conn = new Connection(clusterApiUrl('mainnet-beta'));
  const converter = new SolanaForDefiConverter(conn);
  it('can convert tx', async () => {
    const sig =
      '62ARAHz7gkgkR7tVsT4iiP9X8s6kRgGjAADHnYZg43TWWNwJfy3ebfPFLGAdHHmjpYxbyyQ8GWHVx5VCMS4uRVcA';
    const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
    if (tx === null) throw new Error(`Failed to get tx: ${sig}`);
    const expectedAccounts = [
      { signer: true, writable: true, address: '7FfB2zQRYUQwpPzkRxAeg2mCBGeCRKp4PCEeULJA9xTo' },
      { signer: false, writable: true, address: '59v2cSbCsnyaWymLnsq6TWzE6cEN5KJYNTBNrcP4smRH' },
      { signer: false, writable: true, address: '7x4VcEX8aLd3kFsNWULTp1qFgVtDwyWSxpTGQkoMM6XX' },
      { signer: false, writable: true, address: '64TTtXybNmYeiophmueuNiFiZvLpE5ZwEqLhQujgrgXv' },
      { signer: false, writable: true, address: '5guKGTwRySd1Wg4v3NjAa77fchypMjgFdT5bhmSPNH17' },
      { signer: false, writable: true, address: '6dB6aNx59NSfLR42xvgMkPWdzb2HvC5LYetY5bt2q8XT' },
      { signer: false, writable: false, address: 'ComputeBudget111111111111111111111111111111' },
      { signer: false, writable: false, address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' },
      { signer: false, writable: false, address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { signer: false, writable: false, address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' },
      { signer: false, writable: false, address: '6U91aKa8pmMxkJwBCfPTmUEfZi6dHe7DcFq2ALvB2tbB' },
      { signer: false, writable: false, address: 'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf' },
      { signer: false, writable: false, address: 'dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo' },
      { signer: false, writable: false, address: '8zLzdb17bBTYUTKPz2oDdWSW7AgorYzi9p6pR2Vx3mG8' },
      { signer: false, writable: true, address: '86eq4kdBkUCHGdCC2SfcqGHRCBGhp2M89aCmuvvxaXsm' },
      { signer: false, writable: true, address: 'ELFYDkPYWBopH5Msm2cbA2ueByCXEKpzKWanv1kZC9L2' },
      { signer: false, writable: true, address: '6Nij2pGdpgd6EutLAtdRwQoHaKKxhdNBi4zoLgd9Yuaq' },
      { signer: false, writable: true, address: 'FbQYjLEq1vNCszmxmxZDoFiy9fgyfdPxzt9Fu5zk5jJ4' },
      { signer: false, writable: true, address: 'FX5PBDb4nVTs4f9dSkUsj55rEYrCkBs9e7xZpDHqDeVM' },
      { signer: false, writable: true, address: 'cUkpFTB49f8PeLN9B9acU8r4Hpc4ePUq35SfdFRWrxw' },
      { signer: false, writable: true, address: 'DDz9VCZBB6JktMKyx5Ab31WHK2hDQcb9NSm6WnauWrkb' },
      { signer: false, writable: false, address: '2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c' },
      { signer: false, writable: false, address: 'HVoJWyPbQn4XikG9BY2A8wP27HJQzHAoDnAs1SfsATes' },
      { signer: false, writable: false, address: 'EPBJUVCmzvwkGPGcEuwKmXomfGt78Aozy6pj44x9xxDB' },
      { signer: false, writable: false, address: 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG' },
      { signer: false, writable: false, address: 'CdgEC82BZAxFAJFpVPZ1RtnDr9AyH8KP9KygYhCb39eJ' },
      { signer: false, writable: false, address: 'So11111111111111111111111111111111111111112' },
      { signer: false, writable: false, address: '11111111111111111111111111111111' },
      { signer: false, writable: false, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
      { signer: false, writable: false, address: 'exe59FS5cojZkPJVDFDV8RnXCC7wd6yoBjsUtqH7Zai' },
      { signer: false, writable: false, address: 'CjbUPZFLEwSPc6xJ4LMq4kEuuozVmEdgHHRKzoHVEbbB' },
      { signer: false, writable: false, address: 'Er2WCXwspm9sWCzn12TrqfG5vzdj5mvY29fvnpoHgSFf' },
      { signer: false, writable: false, address: 'Sysvar1nstructions1111111111111111111111111' },
    ];
    const vtx = new VersionedTransaction(tx.transaction.message);
    const converted = await converter.convert(vtx, '', '1');
    converted.details.accounts.map((acc, idx) => {
      const expected = expectedAccounts[idx];
      if (
        acc.address !== expected.address ||
        acc.signer !== expected.signer ||
        acc.writable !== expected.writable
      ) {
        console.log(`Accounts mismatch, expected: ${expected}, got: ${acc}`);
        throw new Error('Accounts mismatch');
      }
      return acc;
    });
    // console.dir(converted, { depth: 5 });
  });
});
