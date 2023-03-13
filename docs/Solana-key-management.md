
### Generating keypair for solana

You can generate keypair for solana using `@solana/web3.js` library or using Solana CLI

#### Solana CLI keypair generation
1. Install [Solana CLI](https://docs.solana.com/ru/cli/install-solana-cli-tools)
2. Generate keypair using [Paper Wallet](https://docs.solana.com/ru/wallet-guide/paper-wallet#creating-a-paper-wallet) which supports both creating kp from scratch and seed phrase derivation

#### JS Keypair generation
1. Install @solana/web3.js - `npm i @solana/web3.js`
2. Execute following code
```ts
import { Keypair } from "@solana/web3.js";

const kp = Keypair.generate();
const pubkey = kp.publicKey.toBase58();
const priv = Buffer.from(kp.secretKey).toString("hex");

console.log(`Private key (hex-encoded) : 0x${priv}, public (base58): ${pubkey}!`)
```