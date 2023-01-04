# DLN executor: advanced configuration

The config file should represent a Typescript module which exports an Object conforming the [`ExecutorLaunchConfig`](src/config.ts) type. This section describes how to configure its properties.

Since it is implied that the executor's config must have access to your private keys in order to sign and broadcast order fulfillment transactions, we kindly advice to put your private keys in the local `.env` file and refer them via the `process.env.*` object. For clarity, DLN executor is shipped with `sample.env` file which can be used as a foundation for your custom privacy-focused configuration strategy. First, copy the sample file:

```sh
cp sample.env .env
```

Then put sensitive values to the variables defined in this file, effectively reusing them in the configuration file. See the example:

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
    beneficiary: `${process.env.BNB_BENEFICIARY}`,

    // ...
}
```


### Orders feed

The executor engine must have the source of new orders that are being placed on the DLN smart contracts. There can be various source implementations feeding the executor with the new orders (e.g. RPC node, RabbitMQ, etc). deBridge maintains and provides a highly efficient websocket server for speedy order delivery, though you can implement your own order feed using the `IOrderFeed` interface.

```ts
const config: ExecutorLaunchConfig = {
    // use the custom ws address provided by deBridge.
    // Could be a URL to WSS or the IOrderFeed implementation as well
    orderFeed: environment.WSS,
}
```

### Order filters

As soon as the executor engine obtains the next order to execute, it passes it through the set of explicitly defined rules called *filters* before making an attempt to fulfill it.

Whenever the order is received, the executor applies three groups of filters:
1. the global set of filters, defined in the `filters` property
2. the set of filters defined in the `srcFilters` property from the configuration of the chain the order originating from
3. the set of filters defined in the `dstFilters` property from the configuration of the chain the order is targeting to

Each filter is just a simple async function which accepts an instance of the given order, and returns a boolean result indicating the approval. If, and only if each and every filter has approved the order, it is being passed to fulfillment.

Filters can be set globally using the `filters` property, which means they will be called when executing an order from/to any supported chain. This is a useful way to define constraints applicable to all supported chains. For example, let's define the global expected profitability of an order:

```ts
const config: ExecutorLaunchConfig = {
    filters: [
        filters.takeAmountUsdEquivalentBetween(0, 10_000),
        // ...
    ],
}
```

Filters can be additionally applied per supported chain (more on this in the [section below](#chain-related-configuration)), giving the flexibility to set tight constraints on chain-specific context, for example filtering out orders whose input `giveToken` is from the given white list or whose USD equivalent of the outcome (`takeAmount`) is within a specific range:

```ts
const config: ExecutorConfig = {
    chains: [
        {
            chain: ChainId.BSC,

            // defines filters for orders coming FROM the BNB Chain
            srcFilters: [
                // if the order is coming from BNB chain, accept it only if BUSD is the giveToken
                filters.whitelistedGiveToken([
                    '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56'
                ]),
            ],

            // defines filters for orders coming TO the BNB Chain
            dstFilters: [
                // fulfill orders on BNB only if the requested amount from $0 to $10,000
                filters.takeAmountUsdEquivalentBetween(0, 10_000),
            ],
        }
    ]
}
```

The engine provides a handy set of built in filters to cover most cases that may arise during fine tuning of the order executor. Each filter can be applied either globally or per-chain. This section covers all of them.


#### `disableFulfill()`

Prevents orders coming to the given chain from fulfillment. This filter is useful to filter off orders that are targeted to the chain you don't want to fulfill in, which is still needed to be presented in the configuration file to enable orders coming from this chain.

For example, you may want to fulfill orders on Solana and Ethereum, accepting orders coming from Solana, Ethereum, and Avalanche (but not others): this is possible by configuring:
- fulfillment rules for Solana and Ethereum,
- unlocking rules for Solana, Ethereum and Avalanche, and
- explicitly disabling fulfillment in Avalanche:

```ts
const config: ExecutorConfig = {
    chains: [
        {
            chain: ChainId.Avalanche,

            dstFilters: [
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

#### `giveAmountUSDEquivalentBetween(minUSDEquivalent: number, maxUSDEquivalent: number)`

Checks if the USD equivalent of the order's unlock amount (amount given by the maker upon order creation, deducted by the fees) is in the given range. This filter is useful to filter off uncomfortable volumes, e.g. too low (e.g. less than $10) or too high (e.g., more than $100,000).

```ts
filters: [
    // accept orders with unlock amounts >$10 and <$100K
    filters.giveAmountUSDEquivalentBetween(10, 100_000),
],
```

#### `takeAmountUSDEquivalentBetween(minUSDEquivalent: number, maxUSDEquivalent: number)`

Checks if the USD equivalent of the order's requested amount (amount that should be supplied to fulfill the order successfully) is in the given range. This filter is useful to filter off uncomfortable volumes, e.g. too low (e.g. less than $10) or too high (e.g., more than $100,000).

```ts
filters: [
    // accept orders with unlock amounts >$10 and <$100K
    filters.takeAmountUSDEquivalentBetween(10, 100_000),
],
```

#### `whitelistedMaker(addresses: string[])`

Checks if the address who placed the order on the source chain is in the whitelist. This filter is useful to filter out orders placed by the trusted parties.

#### `whitelistedReceiver(addresses: address[])`

Checks if the receiver address set in the order is in the given whitelist. This filter is useful to filter out orders placed by the trusted parties.

```ts
dstFilters: [
    // only fulfill orders which transfer funds to the given receiver address
    filters.whitelistedReceiver(['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'])
],
```

#### `whitelistedGiveToken(addresses: string[])`

Checks if the order's locked token is in the whitelist. This filter is useful to target orders that hold only liquid tokens (e.g., ETH, USDC, etc).

```ts
const config: ExecutorConfig = {
    chains: [
        {
            chain: ChainId.Ethereum,

            srcFilters: [
                // if the order is coming from Ethereum chain, accept ETH and USDT only
                filters.whitelistedGiveToken([
                    '0x0000000000000000000000000000000000000000',
                    '0xdAC17F958D2ee523a2206206994597C13D831ec7'
                ]),
            ],
        }
    ]
}
```

#### `blacklistedGiveToken(addresses: string[])`

Checks if the order's locked token is not in the blacklist. This filter is useful to filter off orders that hold undesired and/or illiquid tokens.

#### `whitelistedTakeToken(addresses: string[])`

Checks if the order's requested token is in the whitelist. This filter is useful to target orders that request specific tokens.

#### `blacklistedTakeToken(addresses: string[])`

Checks if the order's requested token is not in the blacklist. This filter is useful to filter off orders that requested undesired and/or illiquid tokens.

#### Custom filter

Developing custom filter requires a basic knowledge of Javascript and preferably Typescript. All you need is to define an async function that conforms the [`OrderFilterInitializer`](src/config.ts) type. For example, a filter that checks if the order's receiver address (the address where the funds would be sent to) is known:

```ts
export function receiverKnown(knownReceiverAddress): OrderFilterInitializer {
  return async (order: OrderData, pmmClient: PMMClient, config: ExecutorConfig) => {
    return buffersAreEqual(order.receiver, convertAddressToBuffer(chainId, knownReceiverAddress));
  }
}
```

Then such filter can be used in the configuration:

```ts
filters: [
    receiverKnown("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")
],
```

### Order processor

After the order has successfully passed the validation, the executor attempts to fulfill the order by running the given order processor, which implements the fulfillment strategy. The executor is shipped with a single processor which utilized token buckets and reserve funds to validate and fulfill orders. Refer to [this documentation](./README.md#understanding-reserve-funds) about this.

A processor can be attached globally to the `orderProcessor` property, which means it will be used for processing valid orders on all supported chains, or it can be set per chain:

```ts
const config: ExecutorLaunchConfig = {
    // use universalProcessor for all chains defined in this list
    orderProcessor: processors.universalProcessor({
        minProfitabilityBps: 4,
        mempoolInterval: 60 * 5, // 5m
    }),

    chains: [
        {
            chain: ChainId.Ethereum,
        },

        {
            chain: ChainId.Solana,
        },

        {
            chain: ChainId.BSC,

            // explicitly use universalProcessor for BNB chain
            orderProcessor: processors.universalProcessor({
                minProfitabilityBps: 4,
                mempoolInterval: 60 * 5, // 5m
            })
        },
    ]
}
```

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

A configuration engine preserves a list of defaults representing the mainnet deployments of the DLN smart contracts per each chain. See [predefined environment configurations](./src/environments.ts) for details. The `CURRENT_ENVIRONMENT` environment refers to the `PRODUCTION` environment by default.

#### Taker related configuration

> **Caution!** Properties from this section define sensitive data used by the DLN executor to operate reserve funds. Since it is implied that the executor's config must have access to your private keys in order to sign and broadcast order fulfillment transactions, we kindly advice to put your private keys in the local `.env` file and refer them via the `process.env.*` object. For clarity, DLN executor is shipped with `sample.env` file which can be used as a foundation for your custom privacy-focused configuration strategy.

The `beneficiary` property defines taker controlled address where the orders-locked funds (fulfilled on the other chains) would be unlocked to.

The `takerPrivateKey` property defines the private key with the reserve funds available to fulfill orders. The DLN executor will sign transactions on behalf of this address, effectively setting approval, transferring funds, performing swaps and fulfillments.

The `unlockAuthorityPrivateKey` property defines the private key to unlock successfully fulfilled orders. The DLN executor will sign transactions on behalf of this address, effectively unlocking the orders.

```ts
const config: ExecutorConfig = {
    chains: [
        {
            chain: ChainId.Solana,

            // if the order is created on Solana and fulfilled on another chain (e.g. Ethereum),
            // unlocked funds will be sent to this Solana address
            beneficiary: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",

            // if the order is created on another chain (e.g. Ethereum), DLN executor would attempt to fulfill
            // this order on behalf of this address
            // Warn! base58 representation of a private key.
            // Warn! For security reasons, put it to the .env file
            takerPrivateKey: `${process.env.SOLANA_TAKER_PRIVATE_KEY}`,

            // Warn! base58 representation of a private key.
            // Warn! For security reasons, put it to the .env file
            unlockAuthorityPrivateKey: `${process.env.SOLANA_TAKER_PRIVATE_KEY}`,
        },

        {
            chain: ChainId.Ethereum,

            // if the order is created on Ethereum and fulfilled on another chain (e.g. Solana),
            // unlocked funds will be sent to this Ethereum address
            beneficiary: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",

            // if the order is created on another chain (e.g. Solana), DLN executor would attempt to fulfill
            // this order on behalf of this address
            // Warn! base64 representation of a private key.
            // Warn! For security reasons, put it to the .env file
            takerPrivateKey: `${process.env.POLYGON_TAKER_PRIVATE_KEY}`,

            // if the order is created on another chain (e.g. Solana), DLN executor would unlock it
            // after successful fulfillment on behalf of this address
            // Warn! base64 representation of a private key.
            // Warn! For security reasons, put it to the .env file
            unlockAuthorityPrivateKey: `${process.env.POLYGON_UNLOCK_AUTHORITY_PRIVATE_KEY}`,
        },
    ]
}
```


### Price service

Most built in filters and rules applied to orders depend on the current market price of the tokens involved in the order. It is possible to set up a custom service responsible for obtaining current market prices, by setting the `tokenPriceService` property:

```ts
const config: ExecutorConfig = {
    tokenPriceService: new CoingeckoPriceFeed(apiKey),
}
```

## Logs

By default, DLN executor prints summary logs to the stdout, indicating the summary of order execution (validation and fulfillment). Example:

```
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] Received, give 1500000000000000000000 of 0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56 on chain=56, take 1485000000 of 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174 on chain=137
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] filter srcChainDefined: approved, chain=56 defined
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] filter dstChainDefined: approved, chain=137 defined
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] filter giveAmountUSDEquivalentBetween: approved, give amount ($1500) within range [$10, $100000]
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] filter takeAmountUSDEquivalentBetween: approved, take amount ($1485) within range [$10, $100000]
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] filter whitelistedGiveToken: approved, give token 0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56 is in the white list
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] filter blacklistedTakeToken: approved, take token 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174 is not in the black list
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] Validated: 7/7 passed
[Order 4d51b661-a05f-49d5-a2ea-699222deefbd] Processed preswapProcessor: fulfilled, swapped 4000000000000000000 of 0x0000000000000000000000000000000000000000 to 1485000000 of 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
```
