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
  PriceTokenService,
  Solana,
  SwapConnector,
  SwapConnectorImpl,
  tokenStringToBuffer,
} from "@debridge-finance/dln-client";
import { helpers } from "@debridge-finance/solana-utils";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { Logger } from "pino";

import { ChainDefinition, ExecutorLaunchConfig, SupportedChain } from "../config";
import { PRODUCTION } from "../environments";
import * as filters from "../filters";
import { OrderFilter } from "../filters";
import { DlnClient, GetNextOrder, IncomingOrder, OrderInfoStatus } from "../interfaces";
import { WsNextOrder } from "../orderFeeds/ws.order.feed";
import * as processors from "../processors";
import { EvmProviderAdapter } from "../providers/evm.provider.adapter";
import { ProviderAdapter } from "../providers/provider.adapter";
import { SolanaProviderAdapter } from "../providers/solana.provider.adapter";
import { HooksEngine } from "../hooks/HooksEngine";
import { NonFinalizedOrdersBudgetController } from "../processors/NonFinalizedOrdersBudgetController";
import { DstOrderConstraints as RawDstOrderConstraints, SrcOrderConstraints as RawSrcOrderConstraints } from "../config";
import { TVLBudgetController } from "../processors/TVLBudgetController";
import { StatsAPI } from "../processors/stats_api/StatsAPI";
import { createClientLogger } from "../logger";
import { TokensBucket, setSlippageOverloader } from "@debridge-finance/legacy-dln-profitability";
import { DlnConfig } from "@debridge-finance/dln-client/dist/types/evm/core/models/config.model";


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
}

export type ExecutorInitializingChain = Readonly<{
  chain: ChainId;
  chainRpc: string;
  unlockProvider: ProviderAdapter;
  fulfillProvider: ProviderAdapter;
}>;

type DstOrderConstraints = Readonly<{
  fulfillmentDelay: number;
  preFulfillSwapChangeRecipient: "taker" | "maker";
}>

type DstConstraintsPerOrderValue = Array<
  DstOrderConstraints & Readonly<{
  upperThreshold: number;
}>
>;

type SrcOrderConstraints = Readonly<{
  fulfillmentDelay: number;
}>

type SrcConstraintsPerOrderValue = Array<
  SrcOrderConstraints & Readonly<{
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
  srcConstraints: Readonly<SrcOrderConstraints & {
    perOrderValue: SrcConstraintsPerOrderValue
  }>,
  dstConstraints: Readonly<DstOrderConstraints & {
    perOrderValue: DstConstraintsPerOrderValue
  }>,
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
}

export class Executor implements IExecutor {
  tokenPriceService: PriceTokenService;
  swapConnector: SwapConnector;
  orderFeed: GetNextOrder;
  chains: { [key in ChainId]?: ExecutorSupportedChain } = {};
  buckets: TokensBucket[] = [];
  client: DlnClient;

  private isInitialized = false;
  private readonly url1Inch = "https://nodes.debridge.finance";
  constructor(private readonly logger: Logger) { }

  private getTokenBuckets(config: ExecutorLaunchConfig['buckets']): Array<TokensBucket> {
    return config.map(metaBucket => {
      const tokens = Object.fromEntries(
        Object.entries(metaBucket).map(
          ([key, value]) => [key, typeof value === 'string' ? [value] : value]
        )
      );
      return new TokensBucket(tokens)
    })
  }

  async init(config: ExecutorLaunchConfig) {
    if (this.isInitialized) return;

    this.tokenPriceService =
      config.tokenPriceService || new CoingeckoPriceFeed();

    if (config.swapConnector) {
      throw new Error("Custom swapConnector not implemented");
    }
    const oneInchConnector = new OneInchConnector(this.url1Inch);
    const jupiterConnector = new JupiterWrapper();
    this.swapConnector = new SwapConnectorImpl(
      oneInchConnector,
      jupiterConnector
    );

    this.buckets = this.getTokenBuckets(config.buckets);
    const hooksEngine = new HooksEngine(config.hookHandlers || {}, this.logger);

    const addresses = {} as any;
    for (const chain of config.chains) {
      switch (getEngineByChainId(chain.chain)) {
        case ChainEngine.EVM: {
          addresses[chain.chain] = {
            pmmSourceAddress:
              chain.environment?.pmmSrc ||
              PRODUCTION.defaultEvmAddresses?.pmmSrc ||
              PRODUCTION.chains[chain.chain]?.pmmSrc,
            pmmDestinationAddress:
              chain.environment?.pmmDst ||
              PRODUCTION.defaultEvmAddresses?.pmmDst ||
              PRODUCTION.chains[chain.chain]?.pmmDst,
            deBridgeGateAddress:
              chain.environment?.deBridgeContract ||
              PRODUCTION.defaultEvmAddresses?.deBridgeContract ||
              PRODUCTION.chains[chain.chain]?.deBridgeContract,
            crossChainForwarderAddress:
              chain.environment?.evm?.forwarderContract ||
              PRODUCTION.defaultEvmAddresses?.evm?.forwarderContract ||
              PRODUCTION.chains[chain.chain]?.evm?.forwarderContract,
          };
        }
      }
    }

    const clients: ClientImplementation[] = [];
    const evmChainConfig: DlnConfig["chainConfig"] = {};
    for (const chain of config.chains) {
      this.logger.info(`initializing ${ChainId[chain.chain]}...`);

      if (!SupportedChain[chain.chain]) {
        throw new Error(`${ChainId[chain.chain]} is not supported, remove it from the config`)
      }

      let client, unlockProvider, fulfillProvider;
      let contractsForApprove: string[] = [];

      if (chain.chain === ChainId.Solana) {
        const solanaConnection = new Connection(chain.chainRpc);
        const solanaPmmSrc = new PublicKey(
          chain.environment?.pmmSrc ||
          PRODUCTION.chains[ChainId.Solana]!.pmmSrc!
        );
        const solanaPmmDst = new PublicKey(
          chain.environment?.pmmDst ||
          PRODUCTION.chains[ChainId.Solana]!.pmmDst!
        );
        const solanaDebridge = new PublicKey(
          chain.environment?.deBridgeContract ||
          PRODUCTION.chains![ChainId.Solana]!.deBridgeContract!
        );
        const solanaDebridgeSetting = new PublicKey(
          chain.environment?.solana?.debridgeSetting ||
          PRODUCTION.chains![ChainId.Solana]!.solana!.debridgeSetting!
        );

        const decodeKey = (key: string) =>
          Keypair.fromSecretKey(
            chain.takerPrivateKey.startsWith("0x")
              ? helpers.hexToBuffer(key)
              : bs58.decode(key)
          );
        fulfillProvider = new SolanaProviderAdapter(
          solanaConnection,
          decodeKey(chain.takerPrivateKey)
        );
        unlockProvider = new SolanaProviderAdapter(
          solanaConnection,
          decodeKey(chain.unlockAuthorityPrivateKey)
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
          chain.environment?.solana?.environment
        );
        await client.destination.debridge.init();

        // TODO: wait until solana enables getProgramAddress with filters for ALT and init ALT if needed
        const altInitTx = await client.initForFulfillPreswap(
          new PublicKey(client.parseAddress(chain.beneficiary)),
          config.chains.map(chainConfig => chainConfig.chain),
          jupiterConnector
        );
        if (altInitTx) {
          this.logger.info(`Initializing Solana Address Lookup Table (ALT)`)
          await fulfillProvider.sendTransaction(altInitTx, { logger: this.logger })
        } else {
          this.logger.info(`Solana Address Lookup Table (ALT) already exists`)
        }
        clients.push(client);
      } else {
        unlockProvider = new EvmProviderAdapter(chain.chain, chain.chainRpc, chain.unlockAuthorityPrivateKey);
        fulfillProvider = new EvmProviderAdapter(chain.chain, chain.chainRpc, chain.takerPrivateKey, chain.environment?.evm?.evmRebroadcastAdapterOpts);

        evmChainConfig[chain.chain] = {
          connection: fulfillProvider.connection, // connection is required for on-chain data reading. No connection .address is used
          dlnSourceAddress:
            chain.environment?.pmmSrc ||
            PRODUCTION.chains[chain.chain]?.pmmSrc ||
            PRODUCTION.defaultEvmAddresses!.pmmSrc!,
          dlnDestinationAddress:
            chain.environment?.pmmDst ||
            PRODUCTION.chains[chain.chain]?.pmmDst ||
            PRODUCTION.defaultEvmAddresses!.pmmDst!,
          deBridgeGateAddress:
            chain.environment?.deBridgeContract ||
            PRODUCTION.chains[chain.chain]?.deBridgeContract ||
            PRODUCTION.defaultEvmAddresses!.deBridgeContract!,
          crossChainForwarderAddress:
            chain.environment?.evm?.forwarderContract ||
            PRODUCTION.chains[chain.chain]?.evm?.forwarderContract ||
            PRODUCTION.defaultEvmAddresses?.evm!.forwarderContract!,
        };

        if (!chain.disabled) {
          contractsForApprove = [
            evmChainConfig[chain.chain]!.dlnDestinationAddress,
            evmChainConfig[chain.chain]!.crossChainForwarderAddress,
          ];
        }
      }

      const processorInitializer =
        chain.orderProcessor ||
        config.orderProcessor ||
        processors.universalProcessor();
      const initializingChain = {
        chain: chain.chain,
        chainRpc: chain.chainRpc,
        unlockProvider,
        fulfillProvider: fulfillProvider,
        nonFinalizedTVLBudget: chain.constraints?.nonFinalizedTVLBudget,
      };
      const orderProcessor = await processorInitializer(chain.chain, {
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
      const dstFilters = await Promise.all(
        [...dstFiltersInitializers, ...(config.filters || [])].map((filter) =>
          filter(chain.chain, {
            chain: initializingChain,
            logger: this.logger,
          })
        )
      );

      const srcFilters = await Promise.all(
        (chain.srcFilters || []).map((initializer) =>
          initializer(chain.chain, {
            chain: initializingChain,
            logger: this.logger,
          })
        )
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
          this.logger
        ),
        TVLBudgetController: new TVLBudgetController({
          giveChainId: chain.chain,
          beneficiary: chain.beneficiary,
          fulfillProvider,
          TVLBudget: chain.constraints?.TVLBudget || 0,
        }, this.buckets),
        beneficiary: tokenStringToBuffer(chain.chain, chain.beneficiary),
        srcConstraints: {
          ...this.getSrcConstraints(chain.constraints || {}),
          perOrderValue: this.getSrcConstraintsPerOrderValue(chain.chain as unknown as SupportedChain, chain.constraints || {})
        },
        dstConstraints: {
          ...this.getDstConstraints(chain.dstConstraints || {}),
          perOrderValue: this.getDstConstraintsPerOrderValue(chain.dstConstraints || {}),
        }
      };
    }

    if (Object.keys(evmChainConfig).length !== 0) {
      clients.push(
        new Evm.DlnClient({
          chainConfig: evmChainConfig,
          enableContractsCache: true,
        })
      );
    }
    this.client = new CommonDlnClient<Evm.DlnClient | Solana.DlnClient>(
      ...(clients as (Evm.DlnClient | Solana.DlnClient)[])
    );

    let orderFeed = config.orderFeed as GetNextOrder;
    if (typeof orderFeed === "string" || !orderFeed) {
      orderFeed = new WsNextOrder(orderFeed);
    }
    orderFeed.setEnabledChains(
      Object.values(this.chains).map((chain) => chain.chain)
    );
    orderFeed.setLogger(this.logger);
    this.orderFeed = orderFeed;

    const unlockAuthorities = Object.values(this.chains).map((chain) => {
      return {
        chainId: chain.chain,
        address: chain.unlockProvider.address as string,
      };
    });

    TVLBudgetController.setGlobalConfig({
      unlockAuthorities: unlockAuthorities.map(i => i.address),
      dlnClient: this.client,
      statsApi: new StatsAPI(),
      priceTokenService: this.tokenPriceService,
    });

    const minConfirmationThresholds = Object.values(this.chains)
      .map(chain => ({
        chainId: chain.chain,
        points: chain.srcConstraints.perOrderValue
          .map(t => t.minBlockConfirmations)
          .filter(t => t > 0) // skip empty block confirmations
      }))
      .filter(range => range.points.length > 0); // skip chains without necessary confirmation points
    orderFeed.init(this.execute.bind(this), unlockAuthorities, minConfirmationThresholds, hooksEngine);

    // Override internal slippage calculation: do not reserve slippage buffer for pre-fulfill swap
    setSlippageOverloader(() => 0);

    this.isInitialized = true;
  }

  private getDstConstraintsPerOrderValue(configDstConstraints: ChainDefinition['dstConstraints']): DstConstraintsPerOrderValue {
    return (configDstConstraints?.perOrderValueUpperThreshold || [])
      .map(constraint => ({
        upperThreshold: constraint.upperThreshold,
        ...this.getDstConstraints(constraint, configDstConstraints)
      }))
      // important to sort by upper bound ASC for easier finding of the corresponding range
      .sort((constraintA, constraintB) => constraintA.upperThreshold - constraintB.upperThreshold);
  }

  private getDstConstraints(primaryConstraints: RawDstOrderConstraints, defaultConstraints?: RawDstOrderConstraints): DstOrderConstraints {
    return {
      fulfillmentDelay: primaryConstraints?.fulfillmentDelay || defaultConstraints?.fulfillmentDelay || 0,
      preFulfillSwapChangeRecipient: primaryConstraints?.preFulfillSwapChangeRecipient || defaultConstraints?.preFulfillSwapChangeRecipient || "taker"
    }
  }

  private getSrcConstraintsPerOrderValue(chain: SupportedChain, configDstConstraints: ChainDefinition['constraints']): SrcConstraintsPerOrderValue {
    return (configDstConstraints?.requiredConfirmationsThresholds || [])
      .map(constraint => {
        if (BLOCK_CONFIRMATIONS_HARD_CAPS[chain] <= (constraint.minBlockConfirmations || 0)) {
          throw new Error(`Unable to set required confirmation threshold for $${constraint.thresholdAmountInUSD} on ${SupportedChain[chain]}: minBlockConfirmations (${constraint.minBlockConfirmations}) must be less than max block confirmations (${BLOCK_CONFIRMATIONS_HARD_CAPS[chain]})`);
        }

        return {
          upperThreshold: constraint.thresholdAmountInUSD,
          minBlockConfirmations: constraint.minBlockConfirmations || 0,
          ...this.getSrcConstraints(constraint, configDstConstraints)
        }
      })
      // important to sort by upper bound ASC for easier finding of the corresponding range
      .sort((constraintA, constraintB) => constraintA.upperThreshold - constraintB.upperThreshold);
  }

  private getSrcConstraints(primaryConstraints: RawSrcOrderConstraints, defaultConstraints?: RawSrcOrderConstraints): SrcOrderConstraints {
    return {
      fulfillmentDelay: primaryConstraints?.fulfillmentDelay || defaultConstraints?.fulfillmentDelay || 0
    }
  }

  async execute(nextOrderInfo: IncomingOrder<any>) {
    const orderId = nextOrderInfo.orderId;
    const logger = this.logger.child({ orderId });
    logger.info(`new order received, type: ${OrderInfoStatus[nextOrderInfo.status]}`)
    logger.debug(nextOrderInfo);
    try {
      await this.executeOrder(nextOrderInfo, logger);
    } catch (e) {
      logger.error(`received error while order execution: ${e}`);
      logger.error(e);
    }
  }

  private async executeOrder(
    nextOrderInfo: IncomingOrder<any>,
    logger: Logger
  ): Promise<boolean> {
    const { order, orderId } = nextOrderInfo;
    if (!order || !orderId) throw new Error("Order is undefined");

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
    if (
      [OrderInfoStatus.Created, OrderInfoStatus.ArchivalCreated].includes(
        nextOrderInfo.status
      )
    ) {
      logger.debug("running filters against the order");
      const orderFilters = await Promise.all(
        listOrderFilters.map((filter) =>
          filter(order, {
            logger,
            config: this,
            giveChain,
            takeChain,
          })
        )
      );

      if (!orderFilters.every((it) => it)) {
        logger.info("order has been filtered off, dropping");
        return false;
      }
    } else {
      logger.debug("accepting order as is");
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
        takeChain
      },
    });

    return true;
  }
}
