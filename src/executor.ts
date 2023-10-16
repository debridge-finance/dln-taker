import {
  Address,
  ChainEngine,
  ChainId,
  ClientImplementation,
  CoingeckoPriceFeed,
  CommonDlnClient,
  Evm,
  getEngineByChainId,
  OrderData,
  PriceTokenService,
  Solana,
  SwapConnector,
  tokenStringToBuffer,
} from '@debridge-finance/dln-client';
import { helpers } from '@debridge-finance/solana-utils';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { Logger } from 'pino';

import { TokensBucket, setSlippageOverloader } from '@debridge-finance/legacy-dln-profitability';
import { DlnConfig } from 'node_modules/@debridge-finance/dln-client/dist/types/evm/core/models/config.model';
import BigNumber from 'bignumber.js';
import Web3 from 'web3';
import {
  ChainDefinition,
  ExecutorLaunchConfig,
  SupportedChain,
  DstOrderConstraints as RawDstOrderConstraints,
  SrcOrderConstraints as RawSrcOrderConstraints,
  SrcConstraints as RawSrcConstraints,
  BLOCK_CONFIRMATIONS_HARD_CAPS,
  SignerAuthority,
} from './config';
import * as filters from './filters/index';
import { OrderFilter } from './filters/index';
import { Authority, GetNextOrder, IncomingOrder, OrderInfoStatus } from './interfaces';
import { WsNextOrder } from './orderFeeds/ws.order.feed';
import { EvmProviderAdapter } from './chain-evm/evm.provider.adapter';
import { SolanaProviderAdapter } from './chain-solana/solana.provider.adapter';
import { HooksEngine } from './hooks/HooksEngine';
import { ThroughputController } from './processors/throughput';
import { TVLBudgetController } from './processors/TVLBudgetController';
import { DataStore } from './processors/DataStore';
import { createClientLogger, DlnClient } from './dln-ts-client.utils';
import { getCurrentEnvironment } from './environments';
import { OrderProcessor } from './processor';
import { TransactionBuilder } from './chain-common/tx-builder';
import { SolanaTransactionBuilder } from './chain-solana/tx-builder';
import { EvmTransactionBuilder } from './chain-evm/tx-builder';
import { SwapConnectorImplementationService } from './processors/swap-connector-implementation.service';

const DEFAULT_MIN_PROFITABILITY_BPS = 4;

export type DstOrderConstraints = Readonly<{
  fulfillmentDelay: number;
  preFulfillSwapChangeRecipient: 'taker' | 'maker';
}>;

type DstConstraintsPerOrderValue = Array<
  DstOrderConstraints &
    Readonly<{
      upperThreshold: number;
    }>
>;

export type SrcConstraints = Readonly<{
  TVLBudget: number;
  profitability: number;
  unlockBatchSize: number;
  immediateUnlockAtUsdValue: number;
}>;

export type SrcOrderConstraints = Readonly<{
  fulfillmentDelay: number;
  maxFulfillThroughputUSD: number;
  throughputTimeWindowSec: number;
}>;

export type SrcConstraintsPerOrderValue = SrcOrderConstraints &
  Readonly<{
    upperThreshold: number;
    minBlockConfirmations: number;
  }>;

export type ExecutorSupportedChain = Readonly<{
  chain: ChainId;
  srcFilters: OrderFilter[];
  dstFilters: OrderFilter[];
  TVLBudgetController: TVLBudgetController;
  throughput: ThroughputController;
  srcConstraints: Readonly<
    SrcConstraints &
      SrcOrderConstraints & {
        perOrderValue: Array<SrcConstraintsPerOrderValue>;
      }
  >;
  dstConstraints: Readonly<
    DstOrderConstraints & {
      perOrderValue: DstConstraintsPerOrderValue;
    }
  >;
  unlockAuthority: Authority;
  fulfillAuthority: Authority;
  unlockBeneficiary: Address;
}>;

export interface IExecutor {
  readonly tokenPriceService: PriceTokenService;
  readonly swapConnector: SwapConnector;
  readonly orderFeed: GetNextOrder;
  readonly chains: { [key in ChainId]?: ExecutorSupportedChain };
  readonly buckets: TokensBucket[];
  readonly client: DlnClient;
  readonly dlnApi: DataStore;
  readonly hookEngine: HooksEngine;

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

  // @ts-ignore Initialized deferredly within the init() method. Should be rewritten during the next major refactoring
  hookEngine: HooksEngine;

  chains: { [key in ChainId]?: ExecutorSupportedChain } = {};

  processors: { [key in ChainId]?: OrderProcessor } = {};

  buckets: TokensBucket[] = [];

  dlnApi: DataStore = new DataStore(this);

  #isInitialized = false;

  readonly #url1Inch = 'https://nodes.debridge.finance';

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
    if (this.#isInitialized) return;

    this.tokenPriceService = config.tokenPriceService || new CoingeckoPriceFeed();

    this.swapConnector = new SwapConnectorImplementationService({
      oneInchApi: this.#url1Inch,
    });

    this.buckets = Executor.getTokenBuckets(config.buckets);
    this.hookEngine = new HooksEngine(config.hookHandlers || {}, this.logger);

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

      if (chain.takerPrivateKey) {
        if (chain.fulfillAuthority)
          throw new Error(
            `Both takerPrivateKey and fulfillAuthority are set for ${
              ChainId[chain.chain]
            }; prefer using fulfillAuthority`,
          );
        chain.fulfillAuthority = {
          type: 'PK',
          privateKey: chain.takerPrivateKey,
        };
      }
      if (!chain.fulfillAuthority)
        throw new Error(`fulfillAuthority is not set for ${ChainId[chain.chain]}`);

      if (chain.unlockAuthorityPrivateKey) {
        if (chain.unlockAuthority)
          throw new Error(
            `Both unlockAuthorityPrivateKey and unlockAuthority are set for ${
              ChainId[chain.chain]
            }; prefer using unlockAuthority`,
          );
        chain.unlockAuthority = {
          type: 'PK',
          privateKey: chain.unlockAuthorityPrivateKey,
        };
      }
      if (chain.unlockAuthority) {
        // if both authorities share the same PK, let's reuse a single object for both
        if (chain.unlockAuthority.type === 'PK' && chain.fulfillAuthority.type === 'PK') {
          if (chain.unlockAuthority.privateKey === chain.fulfillAuthority.privateKey) {
            chain.unlockAuthority = undefined;
          }
        }
      }

      let transactionBuilder: TransactionBuilder | undefined;
      let client;
      let unlockProvider;
      let fulfillProvider;
      let contractsForApprove: string[] = [];

      if (chain.chain === ChainId.Solana) {
        const solanaConnection = new Connection(chain.chainRpc, {
          // force using native fetch because node-fetch throws errors on some RPC providers sometimes
          fetch,
          commitment: 'confirmed',
        });

        (this.swapConnector as SwapConnectorImplementationService).initSolana({
          solanaConnection,
          jupiterApiToken: undefined,
        });

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

        fulfillProvider = Executor.getSolanaProvider(
          chain,
          solanaConnection,
          chain.fulfillAuthority,
        );
        unlockProvider = chain.unlockAuthority
          ? Executor.getSolanaProvider(chain, solanaConnection, chain.unlockAuthority)
          : fulfillProvider;

        client = new Solana.DlnClient(
          solanaConnection,
          solanaPmmSrc,
          solanaPmmDst,
          solanaDebridge,
          solanaDebridgeSetting,
          undefined,
          undefined,
          getCurrentEnvironment().environment,
        );
        transactionBuilder = new SolanaTransactionBuilder(client, fulfillProvider, this);
        clients.push(client);
      } else {
        const connection = new Web3(chain.chainRpc);
        fulfillProvider = Executor.getEVMProvider(chain, connection, chain.fulfillAuthority);

        unlockProvider = chain.unlockAuthority
          ? Executor.getEVMProvider(chain, connection, chain.fulfillAuthority)
          : fulfillProvider;

        evmChainConfig[chain.chain] = {
          connection,
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

        transactionBuilder = new EvmTransactionBuilder(
          chain.chain,
          contractsForApprove,
          connection,
          fulfillProvider,
          this,
        );
      }

      const dstFiltersInitializers = chain.dstFilters || [];
      if (chain.disabled) {
        dstFiltersInitializers.push(filters.disableFulfill());
      }

      // append global filters to the list of dstFilters
      // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
      const dstFilters = await Promise.all(
        [...dstFiltersInitializers, ...(config.filters || [])].map((filter) =>
          filter(chain.chain, {
            logger: this.logger,
          }),
        ),
      );

      // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
      const srcFilters = await Promise.all(
        (chain.srcFilters || []).map((initializer) =>
          initializer(chain.chain, {
            logger: this.logger,
          }),
        ),
      );

      const srcConstraints: ExecutorSupportedChain['srcConstraints'] = {
        ...Executor.getSrcConstraints(
          chain.chain,
          chain.constraints || {},
          config.srcConstraints || {},
        ),
        ...Executor.getSrcOrderConstraints(chain.constraints || {}),
        perOrderValue: Executor.getSrcOrderConstraintsPerOrderValue(
          chain.chain as unknown as SupportedChain,
          chain.constraints || {},
        ),
      };

      this.chains[chain.chain] = {
        chain: chain.chain,
        srcFilters,
        dstFilters,
        unlockAuthority: unlockProvider,
        fulfillAuthority: fulfillProvider,
        throughput: new ThroughputController(
          chain.chain,
          [
            // map all ranges
            ...srcConstraints.perOrderValue.map((constraint) => ({
              minBlockConfirmations: constraint.minBlockConfirmations,
              maxFulfillThroughputUSD: constraint.maxFulfillThroughputUSD,
              throughputTimeWindowSec: constraint.throughputTimeWindowSec,
            })),

            // and the final range covering the finalization (if any)
            {
              minBlockConfirmations:
                BLOCK_CONFIRMATIONS_HARD_CAPS[chain.chain as unknown as SupportedChain],
              maxFulfillThroughputUSD: srcConstraints.maxFulfillThroughputUSD,
              throughputTimeWindowSec: srcConstraints.throughputTimeWindowSec,
            },
          ],
          this.logger,
        ),
        TVLBudgetController: new TVLBudgetController(
          chain.chain,
          this,
          chain.constraints?.TVLBudget || 0,
          this.logger,
        ),
        unlockBeneficiary: tokenStringToBuffer(chain.chain, chain.beneficiary),
        srcConstraints,
        dstConstraints: {
          ...Executor.getDstConstraints(chain.dstConstraints || {}),
          perOrderValue: Executor.getDstConstraintsPerOrderValue(chain.dstConstraints || {}),
        },
      };

      // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
      this.processors[chain.chain] = await OrderProcessor.initialize(
        transactionBuilder,
        this.chains[chain.chain]!,
        this,
        this.logger,
      );
    }

    if (Object.keys(evmChainConfig).length !== 0) {
      clients.push(
        new Evm.DlnClient(
          {
            chainConfig: evmChainConfig,
            enableContractsCache: true,
          },
          getCurrentEnvironment().environment,
        ),
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
      address: chain.unlockAuthority.address as string,
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
      this.hookEngine,
    );

    // Override internal slippage calculation: do not reserve slippage buffer for pre-fulfill swap
    setSlippageOverloader(() => 0);

    this.#isInitialized = true;
  }

  private static getEVMProvider(
    chain: ChainDefinition,
    connection: Web3,
    authority: SignerAuthority,
  ): EvmProviderAdapter {
    switch (authority.type) {
      case 'PK': {
        return new EvmProviderAdapter(
          chain.chain,
          connection,
          authority.privateKey,
          chain.environment?.evm?.evmRebroadcastAdapterOpts,
        );
      }

      // case "ForDefi": {
      //   return new ForDefiAdapter(
      //     chain.chain,
      //     connection,
      //     authority.forDefiVaultId,
      //     authority.forDefiAccessToken
      //   )
      // }

      default:
        throw new Error(`Unsupported authority "${authority.type}" for ${ChainId[chain.chain]}`);
    }
  }

  private static getSolanaProvider(
    chain: ChainDefinition,
    connection: Connection,
    authority: SignerAuthority,
  ): SolanaProviderAdapter {
    const decodeKey = (key: string) =>
      Keypair.fromSecretKey(key.startsWith('0x') ? helpers.hexToBuffer(key) : bs58.decode(key));

    switch (authority.type) {
      case 'PK': {
        return new SolanaProviderAdapter(connection, decodeKey(authority.privateKey));
      }

      default:
        throw new Error(`Unsupported authority "${authority.type}" for ${ChainId[chain.chain]}`);
    }
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

  private static getSrcConstraints(
    chainId: ChainId,
    chainConstraint: RawSrcConstraints,
    sharedConstraint: RawSrcConstraints,
  ): SrcConstraints {
    const maxBatchSize = 10;
    const maxBatchSizeToSolana = 7;

    const srcConstraints = {
      TVLBudget: chainConstraint.TVLBudget || sharedConstraint.TVLBudget || 0,
      profitability:
        chainConstraint.minProfitabilityBps ||
        sharedConstraint.minProfitabilityBps ||
        DEFAULT_MIN_PROFITABILITY_BPS,
      unlockBatchSize:
        chainConstraint.unlockBatchSize || sharedConstraint.unlockBatchSize || maxBatchSize,
      immediateUnlockAtUsdValue:
        chainConstraint.immediateUnlockAtUsdValue ||
        sharedConstraint.immediateUnlockAtUsdValue ||
        0,
    };

    if (srcConstraints.unlockBatchSize < 1 || srcConstraints.unlockBatchSize > maxBatchSize) {
      throw new Error(
        `Unlock batch size is out of bounds: expected [1,${maxBatchSize}]; actual: ${srcConstraints.unlockBatchSize} for ${ChainId[chainId]}`,
      );
    }

    if (chainId === ChainId.Solana) {
      if (srcConstraints.unlockBatchSize > maxBatchSizeToSolana) {
        srcConstraints.unlockBatchSize = maxBatchSizeToSolana;
        // TODO write WARN to log
        // throw new Error(`Unlock batch size for Solana is out of bounds: expected to be up to ${maxBatchSizeToSolana}, actual: ${srcConstraints.unlockBatchSize}`)
      }
    }

    return srcConstraints;
  }

  private static getDstConstraints(
    chainConstraint: RawDstOrderConstraints,
    sharedConstraint?: RawDstOrderConstraints,
  ): DstOrderConstraints {
    return {
      fulfillmentDelay:
        chainConstraint?.fulfillmentDelay || sharedConstraint?.fulfillmentDelay || 0,
      preFulfillSwapChangeRecipient:
        chainConstraint?.preFulfillSwapChangeRecipient ||
        sharedConstraint?.preFulfillSwapChangeRecipient ||
        'taker',
    };
  }

  private static getSrcOrderConstraintsPerOrderValue(
    chain: SupportedChain,
    configSrcConstraints: ChainDefinition['constraints'],
  ): Array<SrcConstraintsPerOrderValue> {
    return (
      (configSrcConstraints?.requiredConfirmationsThresholds || [])
        .map((constraint) => {
          if (BLOCK_CONFIRMATIONS_HARD_CAPS[chain] <= (constraint.minBlockConfirmations || 0)) {
            throw new Error(
              `Unable to set required confirmation threshold for $${constraint.thresholdAmountInUSD} on ${SupportedChain[chain]}: minBlockConfirmations (${constraint.minBlockConfirmations}) must be less than max block confirmations (${BLOCK_CONFIRMATIONS_HARD_CAPS[chain]})`,
            );
          }

          return {
            upperThreshold: constraint.thresholdAmountInUSD,
            minBlockConfirmations: constraint.minBlockConfirmations || 0,
            ...Executor.getSrcOrderConstraints(constraint),
          };
        })
        // important to sort by upper bound ASC for easier finding of the corresponding range
        .sort((constraintA, constraintB) => constraintA.upperThreshold - constraintB.upperThreshold)
    );
  }

  private static getSrcOrderConstraints(constraints: RawSrcOrderConstraints): SrcOrderConstraints {
    return {
      fulfillmentDelay: constraints?.fulfillmentDelay || 0,
      throughputTimeWindowSec: constraints?.throughputTimeWindowSec || 0,
      maxFulfillThroughputUSD: constraints?.maxFulfillThroughputUSD || 0,
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
    this.processors[takeChain.chain]!.handleEvent({
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
