# market-maker-executor

# How to run
1. Install dependencies: `npm i`. You need access to the following private repos:
  - github:debridge-finance/solana-pmm-client
  - debridge-finance/solana-utils
  - debridge-finance/solana-contracts-client
2. Set correct envs in `/src/.env`, example available in `example.env`, more info about env in the [Config](#config) section
3. `npm run loop`

## Flow
1. Init rpc connections and clients for supported chains (listed in the config)
2. Init orderBroker - instance that satisfies [`GetNextOrder` interface](src/interfaces.ts#L33)
3. Wait for order events in infinite loop (order broker should only emit events for supported chains)
  - if Order.Created event is received we start `orderProcessor` routine, see Order Processing [section](#order-processing)
  - else if Order.Fulfilled event is received we check taker field - if order was not fulfilled by us we abort processing for corresponding order
  - else abort order processing (TODO: handle patches)

## Order processing
First of all we want to check profitability of the order. 
Example algorithm is to convert give and take amounts into usd, subtract fees and compare with expected profit. 
Details available [here](src/index.ts#L109-L135)

## Config

### Chain-specific params
Env file expects following structure for each chain: 
```ts
type ChainConfig = {
	PMM_SRC: string; // src contract address
	PMM_DST: string; // dst contract address
	DEBRIDGE: string; // debridge gate address
	DEBRIDGE_SETTINGS?: string; // only needed for solana, deBridge settings contract address
	WALLET: string; // private key in hex format
	RPC_URL: string; // chain rpc url
	BENEFICIARY: string; // beneficiary address in current chain
};
```

To set chain params you have to set all mentioned params in the following format: `ChainId.PMM_SRC=...`, e.g.: `137.PMM_SRC=0x123...` for polygon

### General params
- `WS_URL` - websocket url
- `EXPECTED_PROFIT` expected profit in usd
