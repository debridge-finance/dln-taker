# DLN executor

DLN executor is the rule-based daemon service developed to automatically execute orders placed on the deSwap Liquidity Network (DLN) across supported blockchains.

- [About](#about)
- [Installation](#installation)
- [Configuration](#configuration)
	- [Orders feed](#orders-feed)
	- [Order validators](#order-validators)
	- [Order processor](#order-processor)
	- [Supported chains](#supported-chains)
	- [Price service](#price-service)
- [Logs](#logs)

## About

In a nutshell, DLN is an on-chain system of smart contracts where users (we call them *makers*) place their cross-chain exchange orders, giving a specific amount of input token on the source chain (`giveAmount` of the `giveToken` on the `giveChain`) and specifying the outcome they are willing to take on the destination chain (`takeAmount` of the `takeToken` on the `takeChain`). The given amount is being locked by the DLN smart contract on the source chain, and anyone with enough liquidity (called *takers*) can attempt to fulfill the order by calling the DLN smart contract on the destination chain supplying requested amount of tokens the *maker* is willing to take. After the order is being fulfilled, a cross-chain message is sent to the source chain via the deBridge protocol to unlock the funds, effectively completing the order.

This package is intended to automate the process of order execution: it listens for new orders coming into DLN, filters out those that satisfy custom criteria defined in the config (for example, expected profitability, amount cap, etc), attempts to fulfill them, and unlocks the funds.

## Installation

Download the source code from Github, picking the specific version:

```sh
git clone --depth 1 --single-branch --branch v0.2.0 git@github.com:debridge-finance/dln-executor.git
```

`cd` to the directory and install necessary production dependencies:

```sh
cd dln-executor
npm install --prod
```

Create a configuration file based on the `sample.config.ts`:

```sh
cp sample.config.ts executor.config.ts
```

> 🔴 Currently, DLN is running on the mainnet prerelease environment. You should have received a copy of sample configuration file with overridden defaults. If not, please ask for `prerelease-sample.config.ts` file.

Configure networks to listen to, define rules to filter out orders, set the wallets with the liquidity to fulfill orders with (see the next [section](#configuration)), then launch the executor specifying the name of the configuration file:

```sh
npm run executor executor.config.ts
```

This will keep the executor up and running, listening for new orders and executing those that satisfy the rules. A detailed execution log would appear in the console.


## Configuration

The config file should represent a Typescript module which exports an Object conforming the [`ExecutorConfig`](src/config.ts) type. This section describes how to configure its properties.

Since it is implied that the executor's config must have access to your private keys in order to sign and broadcast order fulfillment transactions, we kindly advice to put your private keys in the local `.env` file and refer them via the `process.env.*` object. See the example:

```env
# File: .env

SOLANA_TAKER_PRIVATE_KEY=abc...

BNB_TAKER_PRIVATE_KEY=
BNB_UNLOCK_AUTHORITY_PRIVATE_KEY=
BNB_BENEFICIARY=
```

```ts
// File: executor.config.ts

{
    // ...

    // gets the value from the .env file from the corresponding line
    takerPrivateKey: `${process.env.SOLANA_TAKER_PRIVATE_KEY}`,

    // ...

    takerPrivateKey: `${process.env.BNB_TAKER_PRIVATE_KEY}`,
    unlockAuthorityPrivateKey: `${process.env.BNB_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
    beneficiary: `${process.env.BNB_BENEFICIARY}`,ITY_PRIVATE_KEY}`,

    // ...
}
```


### Orders feed

The executor engine must have the source of new orders that are being placed on the DLN smart contracts. There can be various source implementations feeding the flow of orders (e.g. RPC node, RabbitMQ, etc). deBridge maintains and provides a highly efficient websocket server for speedy order delivery, though you can implement your own order feed using the `IOrderFeed` interface.

```ts
const config: ExecutorConfig = {
    // use the custom ws address provided by deBridge.
    // Could be the IOrderFeed implementation as well
    orderFeed: "ws://127.0.0.1/ws",
}
```

### Order validators

As soon as the executor engine obtains the next order to execute, it passes it through the set of explicitly defined rules called *validators* before making an attempt to fulfill it.

Whenever the order is received, the executor applies three groups of validators:
1. the global set of validators, defined in the `validators` property
2. the set of validators defined in the `srcValidators` property from the configuration of the chain the order originating from
3. the set of validators defined in the `dstValidators` property from the configuration of the chain the order is targeting to

Each validator is just a simple async function which accepts an instance of the given order, and returns a boolean result indicating the approval. If, and only if each and every validator has approved the order, it is being passed to fulfillment.

Validators can be set globally using the `orderValidators` property, which means they will be called when executing an order from/to any supported chain. This is a useful way to define constraints applicable to all supported chains. For example, let's define the global expected profitability of an order:

```ts
const config: ExecutorConfig = {
    validators: [
        giveVsTakeUSDAmountsDifference(4 /*bps*/),
        // ...
    ],
}
```

Validators can be additionally applied per supported chain (more on this in the [section below](#chain-related-configuration)), giving the flexibility to set tight constraints on chain-specific context, for example filtering out orders whose input `giveToken` is from the given white list or whose USD equivalent of the outcome (`takeAmount`) is within a specific range:

```ts
const config: ExecutorConfig = {
    chains: [
        {
            chain: ChainId.BSC,

            // defines validators for orders coming FROM the BNB Chain
            srcValidators: [
                // if the order is coming from BNB chain, accept it only if BUSD is the giveToken
                whitelistedGiveToken([
                    '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56'
                ]),
            ],

            // defines validators for orders coming TO the BNB Chain
            dstValidators: [
                // fulfill orders on BNB only if the requested amount from $0 to $10,000
                takeAmountUsdEquivalentBetween(0, 10_000),
            ],
        }
    ]
}
```

The engine provides a handy set of built in validators to cover most cases that may arise during fine tuning of the order executor. Each validator can be applied either globally or per-chain. This section covers all of them.


#### `srcChainDefined()`

Checks if the source chain for the given order is defined in the config. This validator is made for convenience because it won't be possible to fulfill an order if its source chain is not defined in the configuration file.

#### `dstChainDefined()`

Checks if the destination chain for the given order is defined in the config. This validator is made for convenience because it won't be possible to fulfill an order if its destination chain is not defined in the configuration file.

#### `disableFulfill()`

Prevents orders coming to the given chain from fulfillment. This validator is useful to filter off orders that are targeted to the chain you don't want to fulfill in, which is still needed to be presented in the configuration file to enable orders coming from this chain.

For example, you may want to fulfill orders on Solana and Ethereum, accepting orders coming from Solana, Ethereum, and Avalanche (but not others): this is possible by configuring:
- fulfillment rules for Solana and Ethereum,
- unlocking rules for Solana, Ethereum and Avalanche, and
- explicitly disabling fulfillment in Avalanche:

```ts
const config: ExecutorConfig = {
    chains: [
        {
            chain: ChainId.Avalanche,

            dstValidators: [
                disableFulfill()
            ],

            // ...
        },

        {
            chain: ChainId.Solana,

            // ...
        },

        {
            chain: ChainId.Ethereum,

            // ...
        },
    ]
}
```


#### `giveVsTakeUSDAmountsDifference(difference: number)`

Checks if the USD equivalent of the order's unlock amount (amount given by the maker upon order creation, deducted by the fees) is the given [basis points](https://en.wikipedia.org/wiki/Basis_point) more than the USD equivalent of the order requested amount.

For example, assume a user places an order giving 1 ETH (≈$1500) and requesting 4.95 BNB (≈$1485). Such order has profitability of 5 bps (0.05%), so it will be approved by the validator setting of `profitabilityBps`=4 and won't be approved by the validator setting of `profitabilityBps`=6.

We suggest keeping the profitability of 4 bps:

```ts
validators: [
    // accept orders with 0.04% margin
    giveVsTakeUSDAmountsDifference(4 /*bps*/),
],
```

#### `giveAmountUSDEquivalentBetween(minUSDEquivalent: number, maxUSDEquivalent: number)`

Checks if the USD equivalent of the order's unlock amount (amount given by the maker upon order creation, deducted by the fees) is in the given range. This validator is useful to filter off uncomfortable volumes, e.g. too low (e.g. less than $10) or too high (e.g., more than $100,000).

```ts
validators: [
    // accept orders with unlock amounts >$10 and <$100K
    giveAmountUSDEquivalentBetween(10, 100_000),
],
```

#### `takeAmountUSDEquivalentBetween(minUSDEquivalent: number, maxUSDEquivalent: number)`

Checks if the USD equivalent of the order's requested amount (amount that should be supplied to fulfill the order successfully) is in the given range. This validator is useful to filter off uncomfortable volumes, e.g. too low (e.g. less than $10) or too high (e.g., more than $100,000).

```ts
validators: [
    // accept orders with unlock amounts >$10 and <$100K
    takeAmountUSDEquivalentBetween(10, 100_000),
],
```

#### `whitelistedMaker(addresses: string[])`

Checks if the address who placed the order on the source chain is in the whitelist. This validator is useful to filter out orders placed by the trusted parties.

#### `whitelistedTaker(addresses: string[])`

Checks if the order explicitly restricts fulfillment with the specific address which is in the given whitelist. This validator is useful to target OTC-like orders routed through DLN.

#### `whitelistedGiveToken(addresses: string[])`

Checks if the order's locked token is in the whitelist. This validator is useful to target orders that hold only liquid tokens (e.g., ETH, USDC, etc).

```ts
const config: ExecutorConfig = {
    chains: [
        {
            chain: ChainId.Ethereum,

            srcValidators: [
                // if the order is coming from Ethereum chain, accept ETH and USDT only
                whitelistedGiveToken([
                    '0x0000000000000000000000000000000000000000',
                    '0xdAC17F958D2ee523a2206206994597C13D831ec7'
                ]),
            ],
        }
    ]
}
```

#### `blacklistedGiveToken(addresses: string[])`

Checks if the order's locked token is not in the blacklist. This validator is useful to filter off orders that hold undesired and/or illiquid tokens.

#### `whitelistedTakeToken(addresses: string[])`

Checks if the order's requested token is in the whitelist. This validator is useful to target orders that request specific tokens.

#### `blacklistedTakeToken(addresses: string[])`

Checks if the order's requested token is not in the blacklist. This validator is useful to filter off orders that requested undesired and/or illiquid tokens.

#### Custom validator

Developing custom validator requires a basic knowledge of Javascript and preferably Typescript. All you need is to define an async function that conforms the [`OrderValidator`](src/config.ts) type. For example, a validator that checks if the order's receiver address (the address where the funds would be sent to) is known:

```ts
export function receiverKnown(knownReceiverAddress): OrderValidator {
  return async (order: OrderData, pmmClient: PMMClient, config: ExecutorConfig) => {
    return order.receiver === knownReceiverAddress;
  }
}
```

Then such validator can be used in the configuration:

```ts
validators: [
    receiverKnown("0x123...890")
],
```

### Order processor

After the order has successfully passed the validation, the executor attempts to fulfill the order by running the given order processor, which implements the fulfillment strategy. This package provides a basic set of extensible processors, that you can use depending on your needs.

A processor can be attached globally to the `orderProcessor` property, which means it will be used for processing valid orders on all supported chains, or it can be set per chain:

```ts
const config: ExecutorConfig = {
    // use strictProcessor for all chains defined in this list
    orderProcessor: strictProcessor(),

    chains: [
        {
            chain: ChainId.Ethereum,
        },

        {
            chain: ChainId.Solana,
        },

        {
            chain: ChainId.BSC,

            // explicitly use preswapProcessor for BNB chain
            orderProcessor: preswapProcessor(BNB_RESERVES_TOKEN_ADDRESS)
        },
    ]
}
```

Each processor accepts one (or multiple) token addresses which are known as *taker reserves* — funds available at the address represented by the `takerPrivateKey` property that are used to fulfill incoming orders. For example, a taker may hold $1mln BUSD on the BNB Chain and $1mln USDC on the Solana chain: by setting these addresses' private keys to respectful `takerPrivateKey` props and providing these tokens' addresses to the order processor, the engine will be able to execute orders using these funds for order fulfillment.

#### Note on EVM approvals

Due to the nature of EVM smart contracts, token transfers are performed via setting respectful allowance on the token contract and then calling the contract whom the allowance has been given to. In our case, before order processors can call DLN contracts to fulfill new orders, the token holder (represented by the `takerPrivateKey` property) must give enough allowance to allow two DLN contracts (`DlnDestination` and `CrosschainForwarder`) to spent reserve tokens on its behalf.

Currently, order processors does not set allowance automatically, so before you start please set infinite allowances for every reserve token to two smart contracts (represented by `environment.pmmDst` and `environment.evm.forwarderContract` configuration properties) per each supported EVM chain.

Next versions of order processor will handle this case implicitly during initialization.

#### `strictProcessor(approvedTokens: string[])` (default)

A very basic processor attempts to fulfill orders that request tokens presented on the taker's `wallet`. For example, if the taker's `wallet` have only ETH and USDT on the given chain, this processor will attempt to fulfill only those orders that request ETH and USDT, skipping orders that request other tokens (say, USDC).

This processor accepts the list of reserve tokens you are willing to use for order fulfillment. For example, the following configuration will execute orders which request either ETH or USDT:

```ts
orderProcessor: strictProcessor([
    '0x0000000000000000000000000000000000000000', // ETH
    '0xdAC17F958D2ee523a2206206994597C13D831ec7' // USDT
]),
```

This processor will set an infinite allowance to the DLN smart contract on first launch to speed up fulfillments.

#### `preswapProcessor(approvedToken: string)`

This processor attempts to fulfill orders making an atomic swap of the minimum necessary amount of tokens being held on the taker's wallet (we call it *taker's reserve token*) to receive the amount of tokens requested by the order and attempt to fulfill the order in a single transaction.

For example, the taker's `wallet` holds $100,000 USDC. Given the order which requests 1 ETH, the `preswapProcessor()` will craft a transaction which does the following atomically:
1. swaps 1500 USDC to retrieve at least 1 ETH (excess remained will be refunded to the taker's `wallet`)
2. fulfills the wallet supplying 1 ETH to cover the requested amount
3. in case swap of fulfill fails, the whole transaction gets reverted.

This processor accepts a token address you are willing to use for order fulfillment. For example, the following configuration will execute orders using USDT as a reserve address, swapping it to the requested token when necessary:

```ts
orderProcessor: preswapProcessor('0xdAC17F958D2ee523a2206206994597C13D831ec7'), // USDT
```

This processor will set an infinite allowance to the DLN smart contract on first launch to speed up fulfillments.

### Supported chains

DLN is a cross-chain solution, and since each chain has its own peculiarities, you must explicitly define each chain where the orders you as a taker would like to execute are coming from/to. Even if you are going to fulfill orders in one particular chain (e.g., Solana), you MUST configure other chains you are ready process order from (e.g., Ethereum) to support order unlocking.

For example, you want to fulfill orders on Solana and Ethereum, accepting orders coming from Solana, Ethereum, and Avalanche (but not others): this is possible by configuring:
- fulfillment rules for Solana and Ethereum,
- unlocking rules for Solana, Ethereum and Avalanche, and
- explicitly disabling fulfillment in Avalanche.

DLN executor gives you a wide range of configuration options to meet your specific needs. To define chains, use the `chains` property to list all chains you are willing the executor to process:

```ts
const config: ExecutorConfig = {
    chains: [
        {/* chain 1 */},

        {/* chain ... */},

        {/* chain N */},
    ]
}
```

Each chain must contain a list of network-, chain- and taker-related stuff.

#### Network related configuration

For each chain, you must define it's ID and the url to the RPC node:

```ts
chains: [
    {
        chain: ChainId.Solana,
        chainRpc: "https://api.mainnet-beta.solana.com/",
    },
]
```

#### Chain related configuration

A configuration engine preserves a list of defaults representing the mainnet deployments of the DLN smart contracts per each chain. For example, it is well known that the address of the core `deBridgeGate` contract across supported EVM chains is `0x43dE2d77BF8027e25dBD179B491e8d64f38398aA`. However, if you are running the executor against non-production environment, you might have received the list of applicable addresses that must override these defaults.

```ts
chains: [
    {
        chain: ChainId.Solana,
        chainRpc: "https://api.mainnet-beta.solana.com/",

        // { this should not be presented in the real world config: mainnet addresses are defined in the internals
            pmmSrc: "srcTG7YiZkebpJJaCQEuqBznRYqrfcj8a917EcMnNUk",
            pmmDst: "dstFoo3xGxv23giLZBuyo9rRwXHdDMeySj7XXMj1Rqn",
            deBridge: "F1nSne66G8qCrTVBa1wgDrRFHMGj8pZUZiqgxUrVtaAQ",
            deBridgeSettings: "14bkTTDfycEShjiurAv1yGupxvsQcWevReLNnpzZgaMh",
        // }

    },
]
```

#### Taker related configuration

> **Caution!** Properties from this section define sensitive data used by the DLN executor to operate funds.

The `beneficiary` property defines taker controlled address where the orders (fulfilled on the other chains) would unlock the funds to.

The `wallet` property defines the private key for the wallet with the funds to fulfill orders. The DLN executor will sign transactions on behalf of this wallet, effectively setting approval, transferring funds, performing swaps and fulfillments.

```ts
const config: ExecutorConfig = {
    chains: [
        {
            chain: ChainId.Solana,

            // if the order is created on Solana and fulfilled on another chain (e.g. Ethereum),
            // unlocked funds will be sent to this Solana address
            beneficiary: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",

            // if the order is created on another chain (e.g. Ethereum), DLN executor would attempt to
            // fulfill such order on behalf of this wallet
            wallet: "abc123...",
        },

        {
            chain: ChainId.Ethereum,

            // if the order is created on Ethereum and fulfilled on another chain (e.g. Solana),
            // unlocked funds will be sent to this Ethereum address
            beneficiary: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",

            // if the order is created on another chain (e.g. Solana), DLN executor would attempt to
            // fulfill such order on behalf of this wallet
            wallet: "abc123...",
        },
    ]
}
```


### Price service

Most built in validators and rules applied to orders depend on the current market price of the tokens involved in the order. It is possible to set up a custom service responsible for obtaining current market prices, by setting the `tokenPriceService` property:

```ts
const config: ExecutorConfig = {
    tokenPriceService: new CoingeckoPriceFeed(apiKey),
}
```

## Logs

By default, DLN executor prints summary logs to the stdout, indicating the summary of order execution (validation and fulfillment). Example:

```
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] Received, give 1500000000000000000000 of 0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56 on chain=56, take 1485000000 of 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174 on chain=137
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] Validator srcChainDefined: approved, chain=56 defined
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] Validator dstChainDefined: approved, chain=137 defined
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] Validator giveVsTakeUSDAmountsDifference: approved, profitability 10bps of required 4bps: give $1500, take $1485
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] Validator giveAmountUSDEquivalentBetween: approved, give amount ($1500) within range [$10, $100000]
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] Validator takeAmountUSDEquivalentBetween: approved, take amount ($1485) within range [$10, $100000]
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] Validator whitelistedGiveToken: approved, give token 0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56 is in the white list
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] Validator blacklistedTakeToken: approved, take token 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174 is not in the black list
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] Validated: 7/7 passed
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] Processed preswapProcessor: fulfilled, swapped 4000000000000000000 of 0x0000000000000000000000000000000000000000 to 1485000000 of 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
```