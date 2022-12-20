import {
  ChainId,
  CoingeckoPriceFeed,
  Evm,
  JupiterWrapper,
  OneInchConnector,
  PMMClient,
  PriceTokenService,
  Solana,
  SwapConnector,
  SwapConnectorImpl,
  TokensBucket,
} from "@debridge-finance/dln-client";
import { helpers } from "@debridge-finance/solana-utils";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { Logger } from "pino";

import { ExecutorLaunchConfig } from "../config";
import { PRODUCTION } from "../environments";
import { OrderFilter } from "../filters";
import { GetNextOrder, IncomingOrder } from "../interfaces";
import { WsNextOrder } from "../orderFeeds/ws.order.feed";
import * as processors from "../processors";
import { createWeb3WithPrivateKey } from "../processors/utils/create.web3.with.private.key";
import { EvmAdapterProvider } from "../providers/evm.provider.adapter";
import { EvmRebroadcastAdapterProviderAdapter } from "../providers/evm.rebroadcast.adapter.provider.adapter";
import { ProviderAdapter } from "../providers/provider.adapter";
import { SolanaProviderAdapter } from "../providers/solana.provider.adapter";

export type ExecutorInitializingChain = {
  chain: ChainId;
  chainRpc: string;
  unlockProvider: ProviderAdapter;
  fulfullProvider: ProviderAdapter;
  client: Solana.PmmClient | Evm.PmmEvmClient;
};

export type ExecutorSupportedChain = {
  chain: ChainId;
  chainRpc: string;
  srcFilters: OrderFilter[];
  dstFilters: OrderFilter[];
  orderProcessor: processors.IOrderProcessor;
  unlockProvider: ProviderAdapter;
  fulfullProvider: ProviderAdapter;
  beneficiary: string;
  client: Solana.PmmClient | Evm.PmmEvmClient;
};

export interface IExecutor {
  readonly tokenPriceService: PriceTokenService;
  readonly swapConnector: SwapConnector;
  readonly orderFeed: GetNextOrder;
  readonly chains: { [key in ChainId]?: ExecutorSupportedChain };
  readonly buckets: TokensBucket[];
  readonly client: PMMClient;
}

export class Executor implements IExecutor {
  tokenPriceService: PriceTokenService;
  swapConnector: SwapConnector;
  orderFeed: GetNextOrder;
  chains: { [key in ChainId]?: ExecutorSupportedChain } = {};
  buckets: TokensBucket[] = [];
  client: PMMClient;

  private isInitialized = false;
  private readonly url1Inch = "https://nodes.debridge.finance";
  constructor(private readonly logger: Logger) {}

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

    this.buckets = config.buckets;

    const clients: { [key in number]: any } = {};
    await Promise.all(
      config.chains.map(async (chain) => {
        this.logger.info(`initializing ${ChainId[chain.chain]}...`);

        let client, unlockProvider, fulfullProvider;
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
          fulfullProvider = new SolanaProviderAdapter(
            solanaConnection,
            decodeKey(chain.takerPrivateKey)
          );
          unlockProvider = new SolanaProviderAdapter(
            solanaConnection,
            decodeKey(chain.unlockAuthorityPrivateKey)
          );

          client = new Solana.PmmClient(
            solanaConnection,
            solanaPmmSrc,
            solanaPmmDst,
            solanaDebridge,
            solanaDebridgeSetting
          );
          // TODO: wait until solana enables getProgramAddress with filters for ALT and init ALT if needed
          await client.initForFulfillPreswap(
            new PublicKey(chain.beneficiary),
            [],
            jupiterConnector
          );
        } else {
          const web3UnlockAuthority = createWeb3WithPrivateKey(
            chain.chainRpc,
            chain.unlockAuthorityPrivateKey
          );
          unlockProvider = new EvmAdapterProvider(web3UnlockAuthority);

          const web3Fulfill = createWeb3WithPrivateKey(
            chain.chainRpc,
            chain.unlockAuthorityPrivateKey
          );
          fulfullProvider = new EvmRebroadcastAdapterProviderAdapter(
            web3Fulfill,
            chain.environment?.evm?.evmRebroadcastAdapterOpts
          );

          client = new Evm.PmmEvmClient({
            enableContractsCache: true,
            addresses: {
              [chain.chain]: {
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
              },
            },
          });
        }

        const processorInitializer =
          chain.orderProcessor ||
          config.orderProcessor ||
          processors.universalProcessor();
        const initializingChain = {
          chain: chain.chain,
          chainRpc: chain.chainRpc,
          unlockProvider,
          fulfullProvider,
          client,
        };
        const orderProcessor = await processorInitializer(chain.chain, {
          takeChain: initializingChain,
          buckets: config.buckets,
          logger: this.logger,
        });

        // append global filters to the list of dstFilters
        const dstFilters = await Promise.all(
          [...(chain.dstFilters || []), ...(config.filters || [])].map(
            (filter) =>
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
          fulfullProvider,
          client,
          beneficiary: chain.beneficiary,
        };

        clients[chain.chain] = client;
      })
    );

    this.client = new PMMClient(clients);

    let orderFeed = config.orderFeed as GetNextOrder;
    if (typeof orderFeed === "string" || !orderFeed) {
      orderFeed = new WsNextOrder(orderFeed);
    }
    orderFeed.setEnabledChains(
      Object.values(this.chains).map((chain) => chain.chain)
    );
    orderFeed.setLogger(this.logger);
    this.orderFeed = orderFeed;

    orderFeed.init(this.execute.bind(this));
    this.isInitialized = true;
  }

  async execute(nextOrderInfo?: IncomingOrder) {
    if (!this.isInitialized) throw new Error("executor is not initialized");
    try {
      this.logger.info(
        `execute nextOrderInfo ${JSON.stringify(nextOrderInfo)}`
      );
      if (nextOrderInfo) {
        const orderId = nextOrderInfo.orderId;
        const logger = this.logger.child({ orderId });
        logger.info(`execute ${orderId} processing is started`);
        await this.processing(nextOrderInfo, logger);
        logger.info(`execute ${orderId} processing is finished`);
      }
    } catch (e) {
      this.logger.error(`Error in execution ${e}`);
      console.error(e);
    }
  }

  private async processing(
    nextOrderInfo: IncomingOrder,
    logger: Logger
  ): Promise<boolean> {
    const { order, orderId } = nextOrderInfo;
    if (!order || !orderId) throw new Error("Order is undefined");

    const takeChain = this.chains[order.take.chainId];
    if (!takeChain)
      throw new Error(
        `${ChainId[order.take.chainId]} not configured, skipping order`
      );

    const giveChain = this.chains[order.give.chainId];
    if (!giveChain)
      throw new Error(
        `${ChainId[order.give.chainId]} not configured, skipping order`
      );

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
    // run filters
    //
    logger.info("Order filtering is started");
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
      logger.info("Order filtering is failed");
      return false;
    }
    logger.info("Order filtering is finished");

    //
    // run processor
    //
    logger.info(`OrderProcessor is started`);
    takeChain.orderProcessor.process({
      orderInfo: nextOrderInfo,
      context: {
        logger,
        config: this,
        giveChain,
      },
    });

    return true;
  }
}
