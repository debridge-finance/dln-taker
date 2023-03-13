# `dln-taker`

`dln-taker` is the rule-based daemon service built to automatically execute profitable orders placed on the deSwap Liquidity Network (DLN) across supported blockchains.

- [TL;DR](#tldr)
- [About DLN](#about-dln)
- [How `dln-taker` works?](#how-dln-taker-works)
- [Installation](#installation)
  - [Preparing the environment](#preparing-the-environment)
  - [Understanding reserve funds](#understanding-reserve-funds)
  - [Deploying reserve funds](#deploying-reserve-funds)
- [Testing the order execution flow in the wild](#testing-the-order-execution-flow-in-the-wild)
  - [Restricting orders from fulfillment](#restricting-orders-from-fulfillment)
  - [Placing new orders](#placing-new-orders)

## TL;DR

- Grab the source code:
```sh
git clone --depth 1 --single-branch --branch v1.0.0-rc.2 git@github.com:debridge-finance/dln-taker.git
```
- `cd` to the directory and install necessary production dependencies:
```sh
cd dln-taker
npm install --prod
```
- Create a configuration file called `executor.config.ts` based on sample:
```sh
cp sample.config.ts executor.config.ts
```
- Create a secrets file called `.env` based on sample:
```sh
cp sample.env .env
```
- Set the values to variables defined in the secrets `.env` file ([more info](#preparing-the-environment))
- Deploy reserve funds to the addresses you have defined in the secrets `.env` file ([more info](#deploying-reserve-funds))
- Launch `dln-taker`:
```sh
npm run executor executor.config.ts
```
- You would see how `dln-taker` executes orders being placed on the DLN

## About DLN

DLN is an on-chain system of smart contracts where users (we call them *makers*) place their cross-chain limit orders, giving a specific amount of input token on the source chain (`giveAmount` of the `giveToken` on the `giveChain`) and specifying the outcome they are willing to take on the destination chain (`takeAmount` of the `takeToken` on the `takeChain`). The given amount is being locked by the DLN smart contract on the source chain, and anyone with enough liquidity (called *takers*) can attempt to fulfill the order by calling the DLN smart contract on the destination chain supplying requested amount of tokens the *maker* is willing to take. After the order is being fulfilled, a cross-chain message is being sent to the source chain via the deBridge protocol to unlock the funds, effectively completing the order.


## How `dln-taker` works?

From the high level perspective, `dln-taker` automates the process of order estimation and execution: it
- **captures new orders** being placed onto DLN by subscribing to the deBridge-managed websocket service which monitors the smart contracts under its hood,
- **filters out orders satisfying custom criteria** defined in the config (e.g., amount cap, target recipient, etc),
- **asserts necessary conditions** to be met (e.g., minimum block confirmations, minimum required profitability), postponing those that don't,
- attempts to **fulfill the order** supplying the requested amount of tokens,
- and **unlocks the funds** upon successful order execution (making this in batches of 10 orders per every supported chain combination),
- regularly **gets back to orders** previously postponed due to being unprofitable.


## Installation

Fetch the source code from Github, picking the given revision (current: `v1.0.0-rc.2`):

```sh
git clone --depth 1 --single-branch --branch v1.0.0-rc.2 git@github.com:debridge-finance/dln-taker.git
```

`cd` to the directory and install necessary production dependencies:

```sh
cd dln-taker
npm install --prod
```

Create a configuration file with the name `executor.config.ts` taking the `sample.config.ts` file as a sample:

```sh
cp sample.config.ts executor.config.ts
```

and prepare the environment for it, as described in the [following section](#preparing-the-environment).

Finally, launch `dln-taker` specifying the name of the configuration file:

```sh
npm run executor executor.config.ts
```

This will keep `dln-taker` up and running, listening for new orders and executing those that satisfy the rules. A detailed execution log would appear in the console.

### Preparing the environment

The [`sample.config.ts` file](./sample.config.ts) already defines all blockchains where DLN is operational:
1. Arbitrum
1. Avalanche
1. BNB Chain
1. Ethereum
1. Polygon
1. Solana

so you don't have to describe them explicitly. However, the sample config uses references to the environment variables (via the `${process.env.*}` notation) where sensitive or private data is involved: for example, an API key to access deBridge-managed websocket, or private keys to wallets with reserve funds for order fulfillment are designed to be accessed by the configuration file as environment variables.

For the sake of simplicity, all variables requested by the `sample.config.ts` are listed in the [`sample.env` file](./sample.env). You can use it as the foundation to create an `.env` file to store your secrets, or reuse it in a hardened way (involving vaults, e.g. Github Secrets or 1password Secrets Automation).

Create an `.env` file using the contents of the [`sample.env` file](./sample.env) file, and set values for all variables for every chain you wish to support, as follows:

> **Caution!** Properties from this section define sensitive data used by `dln-taker` to operate reserve funds.

- `<CHAIN>_RPC` variable defines a URL to the RPC node of the chain.
- `<CHAIN>_TAKER_PRIVATE_KEY` variable defines the private key of the address where the reserve funds available for orders fulfillment. `dln-taker` will sign transactions on behalf of this address, effectively setting approval, transferring funds, performing swaps and fulfillments.
- `<CHAIN>_UNLOCK_AUTHORITY_PRIVATE_KEY` variable defines the private key of the address used to unlock successfully fulfilled orders. `dln-taker` will sign transactions on behalf of this address, effectively unlocking the orders.
- `<CHAIN>_BENEFICIARY` variable defines taker controlled address where the orders-locked funds (fulfilled on the other chains) would be unlocked to. For this you can use the address which corresponds to the private key specified as the `<CHAIN>_TAKER_PRIVATE_KEY`, so funds unlocked by fulfilling the orders would be automatically available as the reserve funds.

> ⚠️ The easiest way to obtain private keys is to export them from your wallets: this would give you a confidence that you are passing the key of the proper account to the dln-taker instance. Consider looking at the [support article](https://support.metamask.io/hc/en-us/articles/360015289632-How-to-export-an-account-s-private-key) explaining how to export a private key from Metamask, or a [video](https://youtu.be/UL4gEsGhtEs?t=243) explaining the same thing for the Phantom wallet.
> ❗️ Exporting your account could be risky as it displays your private key in clear text. To avoid possible loss of funds, make sure no one else sees or is able to capture a screenshot while you retrieve your private key.

The next step is to deploy your assets to the addresses used by `dln-taker` for order fulfillment. Refer the [next section](#deploying-reserve-funds) for details.

If you wish to avoid order fulfillments in a particular chain, use the [`disableFulfill`](./ADVANCED.md#disablefulfill) filter in the config file, however you are **still required** to fill the variables with correct values to enable orders coming from such chain. For example, if you wouldn't want to deploy liquidity on Solana (and thus avoid fulfillments in this chain), add the `disableFulfill` filter to the Solana's section of the configuration file, but you'll still be able to fulfill orders coming **from** Solana. If you wish to exclude the chain from processing, skipping orders coming from and to such chain, just comment out the corresponding section in the config file: in this case, any order coming from or to Solana would be dropped by your instance of `dln-taker`.


### Understanding reserve funds

**Reserve funds** are liquid assets deployed by the taker `dln-taker` uses to fulfill orders.

The core on-chain DLN protocol is designed to work with arbitrary tokens on either side: a user who places an order can **give** arbitrary token and **take** arbitrary token (e.g., create an order giving 1 BNB and taking 0.015 wBTC). To avoid price fluctuations and protect takers from financial losses, users placing orders through the deBridge app and the API are implicitly forced to swap their arbitrary input token to the trusted liquid token from the supported bucket of tokens, which is then being locked by the source smart contract as the give token.

`dln-taker` is designed to match reserve funds against orders' locked give token, assuming that tokens of the same bucket across chains have equal value and near-zero re-balancing costs. For example:
- a user places an order giving 1 BNB on BNB chain taking 0.015 wBTC on Ethereum,
- the deBridge app swaps the input 1 BNB to 255 USDC on BNB chain before order creation,
- `dln-taker` matches 255 USDC locked on BNB to 255 USDC on Ethereum, deducts operating expenses and margin resulting, e.g., 250 USDC, automatically swaps 250 USDC to wBTC using the best market route picked by the 1inch router, and fulfills the order if the swap's outcome is greater than or equal to the amount requested by the order.

![deBridge emulator schema](./assets/DlnPrincipalScheme.png)

As for now, deBridge uses two buckets of tokens for asset routing:
1. the USDC token, emitted by Circle Inc. on every DLN supported chain, and
2. the ETH coin, on Ethereum and Arbitrum

Both buckets are explicitly defined in the sample configuration file [here](./sample.config.ts)), so every taker is required to **load theirs address with enough USDC and ETH on every chain you are willing to fulfill orders on**.

### Deploying reserve funds

For every chain you as a taker would like to support:
- Register the reserves-keeping address (its private key must be set as a `takerPrivateKey` in the configuration file) and load it with:
  - a given amount of USDC tokens (e.g., 100,000 USDC),
  - a given amount of ETH (e.g. 60 ETH) on Ethereum and Arbitrum,
  - a reasonable amount of native blockchain currency (e.g., 1 ETH on Ethereum) to pay gas for fulfillment transactions.
- Register the unlock authority address (its private key must be set as an `unlockAuthorityPrivateKey` in the configuration file) and load it with:
  - a reasonable amount of native blockchain currency (e.g. 1 ETH on Ethereum) to pay gas for order unlocking transactions.

## Testing the order execution flow in the wild

After you have set up and launched `dln-taker`, you may wish to give it a try in a limited conditions.

### Restricting orders from fulfillment

To prevent `dln-taker` from fulfilling third party orders but yours during testing, you can configure it to filter off unwanted orders by adding trusted address to the whitelist of receivers using the [`whitelistedReceiver`](./ADVANCED.md#whitelistedreceiveraddresses-address) filter to each chain:

```ts
dstFilters: [
    // only fulfill orders which transfer funds to the given receiver address
    filters.whitelistedReceiver(['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'])
],
```

This will make `dln-taker` fulfill orders with the `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045` address set as the `receiver` property of an order.

### Placing new orders

You can use the [order placement app](https://dln.debridge.finance/) to place new orders. Mind that you need to have an access code as this product is in the gated launch state.

If you decided to use the `whitelistedReceiver` filter (mentioned in the previous section) then don't forget to set the `receiver` property of an order with your trusted address.

# Smart contract addresses

The DLN smart contracts deployed across supported chains which are used to run the DLN are listed in [this file](./src/environments.ts). `dln-taker` sets the unlimited approvals to the `contracts` upon first launch.
