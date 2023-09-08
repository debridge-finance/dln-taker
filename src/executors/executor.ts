import {
  Address,
  ChainEngine,
  ChainId,
  ClientImplementation,
  CoingeckoPriceFeed,
  CommonDlnClient,
  Evm,
  getEngineByChainId,
  JupiterWrapper,
  OneInchConnector,
  OrderData,
  PriceTokenService,
  Solana,
  SwapConnector,
  SwapConnectorImpl,
  tokenStringToBuffer,
} from '@debridge-finance/dln-client';
import { helpers } from '@debridge-finance/solana-utils';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { Logger } from 'pino';

import { TokensBucket, setSlippageOverloader } from '@debridge-finance/legacy-dln-profitability';
import { DlnConfig } from 'node_modules/@debridge-finance/dln-client/dist/types/evm/core/models/config.model';
import BigNumber from 'bignumber.js';
import {
  ChainDefinition,
  ExecutorLaunchConfig,
  SupportedChain,
  DstOrderConstraints as RawDstOrderConstraints,
  SrcOrderConstraints as RawSrcOrderConstraints,
} from '../config';
import * as filters from '../filters';
import { OrderFilter } from '../filters';
import { DlnClient, GetNextOrder, IncomingOrder, OrderInfoStatus } from '../interfaces';
import { WsNextOrder } from '../orderFeeds/ws.order.feed';
import * as processors from '../processors';
import { EvmProviderAdapter } from '../providers/evm.provider.adapter';
import { ProviderAdapter } from '../providers/provider.adapter';
import { SolanaProviderAdapter } from '../providers/solana.provider.adapter';
import { HooksEngine } from '../hooks/HooksEngine';
import { NonFinalizedOrdersBudgetController } from '../processors/NonFinalizedOrdersBudgetController';
import { TVLBudgetController } from '../processors/TVLBudgetController';
import { DataStore } from '../processors/DataStore';
import { createClientLogger } from '../logger';
import { getCurrentEnvironment } from '../environments';

const BLOCK_CONFIRMATIONS_HARD_CAPS: { [key in SupportedChain]: number } = {
  [SupportedChain.Arbitrum]: 15,
  [SupportedChain.Avalanche]: 15,
  [SupportedChain.BSC]: 15,
  [SupportedChain.Ethereum]: 12,
  [SupportedChain.Fantom]: 15,
  [SupportedChain.Linea]: 15,
  [SupportedChain.Base]: 15,
  [SupportedChain.Optimism]: 15,
  [SupportedChain.Polygon]: 256,
  [SupportedChain.Solana]: 32,
};

export type ExecutorInitializingChain = Readonly<{
  chain: ChainId;
  chainRpc: string;
  unlockProvider: ProviderAdapter;
  fulfillProvider: ProviderAdapter;
}>;

type DstOrderConstraints = Readonly<{
  fulfillmentDelay: number;
  preFulfillSwapChangeRecipient: 'taker' | 'maker';
}>;

type DstConstraintsPerOrderValue = Array<
  DstOrderConstraints &
    Readonly<{
      upperThreshold: number;
    }>
>;

type SrcOrderConstraints = Readonly<{
  fulfillmentDelay: number;
}>;

type SrcConstraintsPerOrderValue = Array<
  SrcOrderConstraints &
    Readonly<{
      upperThreshold: number;
      minBlockConfirmations: number;
    }>
>;

export type ExecutorSupportedChain = Readonly<{
  chain: ChainId;
  chainRpc: string;
  srcFilters: OrderFilter[];
  dstFilters: OrderFilter[];
  TVLBudgetController: TVLBudgetController;
  nonFinalizedOrdersBudgetController: NonFinalizedOrdersBudgetController;
  srcConstraints: Readonly<
    SrcOrderConstraints & {
      perOrderValue: SrcConstraintsPerOrderValue;
    }
  >;
  dstConstraints: Readonly<
    DstOrderConstraints & {
      perOrderValue: DstConstraintsPerOrderValue;
    }
  >;
  orderProcessor: processors.IOrderProcessor;
  unlockProvider: ProviderAdapter;
  fulfillProvider: ProviderAdapter;
  beneficiary: Address;
}>;

export interface IExecutor {
  readonly tokenPriceService: PriceTokenService;
  readonly swapConnector: SwapConnector;
  readonly orderFeed: GetNextOrder;
  readonly chains: { [key in ChainId]?: ExecutorSupportedChain };
  readonly buckets: TokensBucket[];
  readonly client: DlnClient;
  readonly dlnApi: DataStore;

  getSupportedChainIds(): Array<ChainId>;
  getSupportedChain(chain: ChainId): ExecutorSupportedChain;

  usdValueOfAsset(chain: ChainId, token: Address, value: bigint): Promise<number>;
  usdValueOfOrder(order: OrderData): Promise<number>;
  formatTokenValue(chain: ChainId, token: Address, amount: bigint): Promise<number>;
  resyncDecimals(
    chainA: ChainId,
    tokenA: Address,
    amountA: bigint,
    chainB: ChainId,
    tokenB: Address,
  ): Promise<bigint>;
}

export class Executor implements IExecutor {
  // @ts-ignore Initialized deferredly within the init() method. Should be rewritten during the next major refactoring
  tokenPriceService: PriceTokenService;

  // @ts-ignore Initialized deferredly within the init() method. Should be rewritten during the next major refactoring
  swapConnector: SwapConnector;

  // @ts-ignore Initialized deferredly within the init() method. Should be rewritten during the next major refactoring
  orderFeed: GetNextOrder;

  // @ts-ignore Initialized deferredly within the init() method. Should be rewritten during the next major refactoring
  client: DlnClient;

  chains: { [key in ChainId]?: ExecutorSupportedChain } = {};

  buckets: TokensBucket[] = [];

  dlnApi: DataStore = new DataStore(this);

  private isInitialized = false;

  private readonly url1Inch = 'https://nodes.debridge.finance';

  constructor(private readonly logger: Logger) {}

  async usdValueOfAsset(chain: ChainId, token: Address, amount: bigint): Promise<number> {
    const tokenPrice = await this.tokenPriceService.getPrice(chain, token, {
      logger: createClientLogger(this.logger),
    });

    const tokenDecimals = await this.client.getDecimals(chain, token);
    return new BigNumber(amount.toString())
      .multipliedBy(tokenPrice)
      .div(new BigNumber(10).pow(tokenDecimals))
      .toNumber();
  }

  async formatTokenValue(chain: ChainId, token: Address, amount: bigint): Promise<number> {
    const tokenDecimals = await this.client.getDecimals(chain, token);
    return new BigNumber(amount.toString()).div(new BigNumber(10).pow(tokenDecimals)).toNumber();
  }

  async resyncDecimals(
    chainIn: ChainId,
    tokenIn: Address,
    amountIn: bigint,
    chainOut: ChainId,
    tokenOut: Address,
  ): Promise<bigint> {
    const [decimalsIn, decimalsOut] = await Promise.all([
      this.client.getDecimals(chainIn, tokenIn),
      this.client.getDecimals(chainOut, tokenOut),
    ]);
    if (decimalsIn === decimalsOut) return amountIn;

    // ported from fixDecimals() which is not being exported from the client
    const delta = decimalsIn - decimalsOut;
    if (delta > 0) {
      return amountIn / 10n ** BigInt(delta);
    }
    return amountIn * 10n ** BigInt(-delta);
  }

  async usdValueOfOrder(order: OrderData): Promise<number> {
    return this.usdValueOfAsset(order.give.chainId, order.give.tokenAddress, order.give.amount);
  }

  getSupportedChain(chain: ChainId): ExecutorSupportedChain {
    const supportedChain = this.chains[chain];
    if (!supportedChain) throw new Error(`Unsupported chain: ${ChainId[chain]}`);
    return supportedChain;
  }

  getSupportedChainIds(): Array<ChainId> {
    return Object.values(this.chains).map((chain) => chain.chain);
  }

  private static getTokenBuckets(config: ExecutorLaunchConfig['buckets']): Array<TokensBucket> {
    return config.map((metaBucket) => {
      const tokens = Object.fromEntries(
        Object.entries(metaBucket).map(([key, value]) => [
          key,
          typeof value === 'string' ? [value] : value,
        ]),
      );
      return new TokensBucket(tokens);
    });
  }

  async init(config: ExecutorLaunchConfig) {
    if (this.isInitialized) return;

    this.tokenPriceService = config.tokenPriceService || new CoingeckoPriceFeed();

    if (config.swapConnector) {
      throw new Error('Custom swapConnector not implemented');
    }
    const oneInchConnector = new OneInchConnector(this.url1Inch);
    const jupiterConnector = new JupiterWrapper();
    this.swapConnector = new SwapConnectorImpl(oneInchConnector, jupiterConnector);

    this.buckets = Executor.getTokenBuckets(config.buckets);
    const hooksEngine = new HooksEngine(config.hookHandlers || {}, this.logger);

    const addresses = {} as any;
    // special case for EVM: collect addresses into a shared collection
    for (const chain of config.chains) {
      if (ChainEngine.EVM === getEngineByChainId(chain.chain)) {
        addresses[chain.chain] = {
          pmmSourceAddress:
            chain.environment?.pmmSrc ||
            getCurrentEnvironment().defaultEvmAddresses?.pmmSrc ||
            getCurrentEnvironment().chains[chain.chain]?.pmmSrc,
          pmmDestinationAddress:
            chain.environment?.pmmDst ||
            getCurrentEnvironment().chains[chain.chain]?.pmmDst ||
            getCurrentEnvironment().defaultEvmAddresses?.pmmDst,
          deBridgeGateAddress:
            chain.environment?.deBridgeContract ||
            getCurrentEnvironment().chains[chain.chain]?.deBridgeContract ||
            getCurrentEnvironment().defaultEvmAddresses?.deBridgeContract,
          crossChainForwarderAddress:
            chain.environment?.evm?.forwarderContract ||
            getCurrentEnvironment().chains[chain.chain]?.evm?.forwarderContract ||
            getCurrentEnvironment().defaultEvmAddresses?.evm?.forwarderContract,
        };
      }
    }

    const clients: ClientImplementation[] = [];
    const evmChainConfig: DlnConfig['chainConfig'] = {};
    for (const chain of config.chains) {
      this.logger.info(`initializing ${ChainId[chain.chain]}...`);

      if (!SupportedChain[chain.chain]) {
        throw new Error(`${ChainId[chain.chain]} is not supported, remove it from the config`);
      }

      let client;
      let unlockProvider;
      let fulfillProvider;
      let contractsForApprove: string[] = [];

      if (chain.chain === ChainId.Solana) {
        const solanaConnection = new Connection(chain.chainRpc);
        const solanaPmmSrc = new PublicKey(
          chain.environment?.pmmSrc || getCurrentEnvironment().chains[ChainId.Solana]!.pmmSrc!,
        );
        const solanaPmmDst = new PublicKey(
          chain.environment?.pmmDst || getCurrentEnvironment().chains[ChainId.Solana]!.pmmDst!,
        );
        const solanaDebridge = new PublicKey(
          chain.environment?.deBridgeContract ||
            getCurrentEnvironment().chains![ChainId.Solana]!.deBridgeContract!,
        );
        const solanaDebridgeSetting = new PublicKey(
          chain.environment?.solana?.debridgeSetting ||
            getCurrentEnvironment().chains![ChainId.Solana]!.solana!.debridgeSetting!,
        );

        const decodeKey = (key: string) =>
          Keypair.fromSecretKey(
            chain.takerPrivateKey.startsWith('0x') ? helpers.hexToBuffer(key) : bs58.decode(key),
          );
        fulfillProvider = new SolanaProviderAdapter(
          solanaConnection,
          decodeKey(chain.takerPrivateKey),
        );
        unlockProvider = new SolanaProviderAdapter(
          solanaConnection,
          decodeKey(chain.unlockAuthorityPrivateKey),
        );

        client = new Solana.DlnClient(
          solanaConnection,
          solanaPmmSrc,
          solanaPmmDst,
          solanaDebridge,
          solanaDebridgeSetting,
          undefined,
          undefined,
          undefined,
          chain.environment?.solana?.environment,
        );
        // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
        await client.destination.debridge.init();

        // TODO: wait until solana enables getProgramAddress with filters for ALT and init ALT if needed
        // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
        const altInitTx = await client.initForFulfillPreswap(
          new PublicKey(client.parseAddress(chain.beneficiary)),
          config.chains.map((chainConfig) => chainConfig.chain),
          jupiterConnector,
        );
        if (altInitTx) {
          this.logger.info(`Initializing Solana Address Lookup Table (ALT)`);
          // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
          await fulfillProvider.sendTransaction(altInitTx, { logger: this.logger });
        } else {
          this.logger.info(`Solana Address Lookup Table (ALT) already exists`);
        }
        clients.push(client);
      } else {
        unlockProvider = new EvmProviderAdapter(
          chain.chain,
          chain.chainRpc,
          chain.unlockAuthorityPrivateKey,
        );
        fulfillProvider = new EvmProviderAdapter(
          chain.chain,
          chain.chainRpc,
          chain.takerPrivateKey,
          chain.environment?.evm?.evmRebroadcastAdapterOpts,
        );

        evmChainConfig[chain.chain] = {
          connection: fulfillProvider.unsafeGetConnection, // connection is required for on-chain data reading. No connection .address is used
          dlnSourceAddress:
            chain.environment?.pmmSrc ||
            getCurrentEnvironment().chains[chain.chain]?.pmmSrc ||
            getCurrentEnvironment().defaultEvmAddresses!.pmmSrc!,
          dlnDestinationAddress:
            chain.environment?.pmmDst ||
            getCurrentEnvironment().chains[chain.chain]?.pmmDst ||
            getCurrentEnvironment().defaultEvmAddresses!.pmmDst!,
          deBridgeGateAddress:
            chain.environment?.deBridgeContract ||
            getCurrentEnvironment().chains[chain.chain]?.deBridgeContract ||
            getCurrentEnvironment().defaultEvmAddresses!.deBridgeContract!,
          crossChainForwarderAddress:
            chain.environment?.evm?.forwarderContract ||
            getCurrentEnvironment().chains[chain.chain]?.evm?.forwarderContract ||
            getCurrentEnvironment().defaultEvmAddresses?.evm!.forwarderContract!,
        };

        if (!chain.disabled) {
          contractsForApprove = [
            evmChainConfig[chain.chain]!.dlnDestinationAddress,
            evmChainConfig[chain.chain]!.crossChainForwarderAddress,
          ];
        }
      }

      const processorInitializer =
        chain.orderProcessor || config.orderProcessor || processors.universalProcessor();
      const initializingChain = {
        chain: chain.chain,
        chainRpc: chain.chainRpc,
        unlockProvider,
        fulfillProvider,
        nonFinalizedTVLBudget: chain.constraints?.nonFinalizedTVLBudget,
      };
      // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
      const orderProcessor = await processorInitializer(chain.chain, this, {
        takeChain: initializingChain,
        buckets: this.buckets,
        logger: this.logger,
        hooksEngine,
        contractsForApprove,
      });

      const dstFiltersInitializers = chain.dstFilters || [];
      if (chain.disabled) {
        dstFiltersInitializers.push(filters.disableFulfill());
      }

      // append global filters to the list of dstFilters
      // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
      const dstFilters = await Promise.all(
        [...dstFiltersInitializers, ...(config.filters || [])].map((filter) =>
          filter(chain.chain, {
            chain: initializingChain,
            logger: this.logger,
          }),
        ),
      );

      // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
      const srcFilters = await Promise.all(
        (chain.srcFilters || []).map((initializer) =>
          initializer(chain.chain, {
            chain: initializingChain,
            logger: this.logger,
          }),
        ),
      );

      this.chains[chain.chain] = {
        chain: chain.chain,
        chainRpc: chain.chainRpc,
        srcFilters,
        dstFilters,
        orderProcessor,
        unlockProvider,
        fulfillProvider,
        nonFinalizedOrdersBudgetController: new NonFinalizedOrdersBudgetController(
          chain.chain,
          chain.constraints?.nonFinalizedTVLBudget || 0,
          this.logger,
        ),
        TVLBudgetController: new TVLBudgetController(
          chain.chain,
          this,
          chain.constraints?.TVLBudget || 0,
          this.logger,
        ),
        beneficiary: tokenStringToBuffer(chain.chain, chain.beneficiary),
        srcConstraints: {
          ...Executor.getSrcConstraints(chain.constraints || {}),
          perOrderValue: Executor.getSrcConstraintsPerOrderValue(
            chain.chain as unknown as SupportedChain,
            chain.constraints || {},
          ),
        },
        dstConstraints: {
          ...Executor.getDstConstraints(chain.dstConstraints || {}),
          perOrderValue: Executor.getDstConstraintsPerOrderValue(chain.dstConstraints || {}),
        },
      };
    }

    if (Object.keys(evmChainConfig).length !== 0) {
      clients.push(
        new Evm.DlnClient({
          chainConfig: evmChainConfig,
          enableContractsCache: true,
        }),
      );
    }
    this.client = new CommonDlnClient<Evm.DlnClient | Solana.DlnClient>(
      ...(clients as (Evm.DlnClient | Solana.DlnClient)[]),
    );

    let orderFeed = config.orderFeed as GetNextOrder;
    if (typeof orderFeed === 'string') {
      orderFeed = new WsNextOrder(orderFeed);
    }
    orderFeed.setEnabledChains(Object.values(this.chains).map((chain) => chain.chain));
    orderFeed.setLogger(this.logger);
    this.orderFeed = orderFeed;

    const unlockAuthorities = Object.values(this.chains).map((chain) => ({
      chainId: chain.chain,
      address: chain.unlockProvider.address as string,
    }));

    const minConfirmationThresholds = Object.values(this.chains)
      .map((chain) => ({
        chainId: chain.chain,
        points: chain.srcConstraints.perOrderValue
          .map((t) => t.minBlockConfirmations)
          .filter((t) => t > 0), // skip empty block confirmations
      }))
      .filter((range) => range.points.length > 0); // skip chains without necessary confirmation points
    orderFeed.init(
      this.execute.bind(this),
      unlockAuthorities,
      minConfirmationThresholds,
      hooksEngine,
    );

    // Override internal slippage calculation: do not reserve slippage buffer for pre-fulfill swap
    setSlippageOverloader(() => 0);

    this.isInitialized = true;
  }

  private static getDstConstraintsPerOrderValue(
    configDstConstraints: ChainDefinition['dstConstraints'],
  ): DstConstraintsPerOrderValue {
    return (
      (configDstConstraints?.perOrderValueUpperThreshold || [])
        .map((constraint) => ({
          upperThreshold: constraint.upperThreshold,
          ...Executor.getDstConstraints(constraint, configDstConstraints),
        }))
        // important to sort by upper bound ASC for easier finding of the corresponding range
        .sort((constraintA, constraintB) => constraintA.upperThreshold - constraintB.upperThreshold)
    );
  }

  private static getDstConstraints(
    primaryConstraints: RawDstOrderConstraints,
    defaultConstraints?: RawDstOrderConstraints,
  ): DstOrderConstraints {
    return {
      fulfillmentDelay:
        primaryConstraints?.fulfillmentDelay || defaultConstraints?.fulfillmentDelay || 0,
      preFulfillSwapChangeRecipient:
        primaryConstraints?.preFulfillSwapChangeRecipient ||
        defaultConstraints?.preFulfillSwapChangeRecipient ||
        'taker',
    };
  }

  private static getSrcConstraintsPerOrderValue(
    chain: SupportedChain,
    configDstConstraints: ChainDefinition['constraints'],
  ): SrcConstraintsPerOrderValue {
    return (
      (configDstConstraints?.requiredConfirmationsThresholds || [])
        .map((constraint) => {
          if (BLOCK_CONFIRMATIONS_HARD_CAPS[chain] <= (constraint.minBlockConfirmations || 0)) {
            throw new Error(
              `Unable to set required confirmation threshold for $${constraint.thresholdAmountInUSD} on ${SupportedChain[chain]}: minBlockConfirmations (${constraint.minBlockConfirmations}) must be less than max block confirmations (${BLOCK_CONFIRMATIONS_HARD_CAPS[chain]})`,
            );
          }

          return {
            upperThreshold: constraint.thresholdAmountInUSD,
            minBlockConfirmations: constraint.minBlockConfirmations || 0,
            ...Executor.getSrcConstraints(constraint, configDstConstraints),
          };
        })
        // important to sort by upper bound ASC for easier finding of the corresponding range
        .sort((constraintA, constraintB) => constraintA.upperThreshold - constraintB.upperThreshold)
    );
  }

  private static getSrcConstraints(
    primaryConstraints: RawSrcOrderConstraints,
    defaultConstraints?: RawSrcOrderConstraints,
  ): SrcOrderConstraints {
    return {
      fulfillmentDelay:
        primaryConstraints?.fulfillmentDelay || defaultConstraints?.fulfillmentDelay || 0,
    };
  }

  async execute(nextOrderInfo: IncomingOrder<any>) {
    const { orderId } = nextOrderInfo;
    const logger = this.logger.child({ orderId });
    logger.info(`new order received, type: ${OrderInfoStatus[nextOrderInfo.status]}`);
    logger.debug(nextOrderInfo);
    try {
      await this.executeOrder(nextOrderInfo, logger);
    } catch (e) {
      logger.error(`received error while order execution: ${e}`);
      logger.error(e);
    }
  }

  private async executeOrder(nextOrderInfo: IncomingOrder<any>, logger: Logger): Promise<boolean> {
    const { order, orderId } = nextOrderInfo;
    if (!order || !orderId) throw new Error('Order is undefined');

    const takeChain = this.chains[order.take.chainId];
    if (!takeChain) {
      logger.info(`${ChainId[order.take.chainId]} not configured, dropping`);
      return false;
    }

    const giveChain = this.chains[order.give.chainId];
    if (!giveChain) {
      logger.info(`${ChainId[order.give.chainId]} not configured, dropping`);
      return false;
    }

    // to accept an order, all filters must approve the order.
    // executor invokes three groups of filters:
    // 1) defined globally (config.filters)
    // 2) defined as dstFilters under the takeChain config
    // 3) defined as srcFilters under the giveChain config

    // global filters
    const listOrderFilters = [];

    // dstFilters@takeChain
    if (takeChain.dstFilters && takeChain.dstFilters.length > 0) {
      listOrderFilters.push(...takeChain.dstFilters);
    }

    // srcFilters@giveChain
    if (giveChain.srcFilters && giveChain.srcFilters.length > 0) {
      listOrderFilters.push(...giveChain.srcFilters);
    }

    //
    // run filters for create or archival orders
    //
    if ([OrderInfoStatus.Created, OrderInfoStatus.ArchivalCreated].includes(nextOrderInfo.status)) {
      logger.debug('running filters against the order');
      const orderFilters = await Promise.all(
        listOrderFilters.map((filter) =>
          filter(order, {
            logger,
            config: this,
            giveChain,
            takeChain,
          }),
        ),
      );

      if (!orderFilters.every((it) => it)) {
        logger.info('order has been filtered off, dropping');
        return false;
      }
    } else {
      logger.debug('accepting order as is');
    }

    //
    // run processor
    //
    logger.debug(`passing the order to the processor`);
    takeChain.orderProcessor.process({
      orderInfo: nextOrderInfo,
      context: {
        logger,
        config: this,
        giveChain,
        takeChain,
      },
    });

    return true;
  }
}
