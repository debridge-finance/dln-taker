import { ChainId, Evm, PMMClient, PriceTokenService, Solana, SwapConnector, TokensBucket } from "@debridge-finance/dln-client";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Logger } from "pino";
import { PRODUCTION } from "../src/environments";

import { ChainDefinition, ExecutorLaunchConfig } from "./config";
import { GetNextOrder, NextOrderInfo } from "./interfaces";
import { WsNextOrder } from "./orderFeeds/ws.order.feed";
import { CoingeckoPriceFeed } from "@debridge-finance/dln-client";
import { OneInchConnector } from "@debridge-finance/dln-client";
import { ProviderAdapter } from "./providers/provider.adapter";
import { EvmAdapterProvider } from "./providers/evm.provider.adapter";
import { createWeb3WithPrivateKey } from "./processors/utils/create.web3.with.private.key";
import { SolanaProviderAdapter } from "./providers/solana.provider.adapter";
import { helpers } from "@debridge-finance/solana-utils";
import { EvmRebroadcastAdapterProviderAdapter } from "./providers/evm.rebroadcast.adapter.provider.adapter";
import bs58 from "bs58";
import { SwapConnectorImpl } from "@debridge-finance/dln-client";
import { JupiterWrapper } from "@debridge-finance/dln-client";
import * as processors from "./processors";
import { OrderValidator } from "./validators";

export type InitializingChain = {
  chain: ChainId;
  chainRpc: string;
  unlockProvider: ProviderAdapter;
  fulfullProvider: ProviderAdapter;
  client: Solana.PmmClient | Evm.PmmEvmClient;
}

export type SupportedChainConfig = {
  chain: ChainId;
  chainRpc: string;
  srcValidators: OrderValidator[];
  dstValidators: OrderValidator[];
  orderProcessor: processors.OrderProcessor;
  unlockProvider: ProviderAdapter;
  fulfullProvider: ProviderAdapter;
  beneficiary: string;
  client: Solana.PmmClient | Evm.PmmEvmClient;
}

export interface ExecutorConf {
  readonly tokenPriceService: PriceTokenService;
  readonly swapConnector: SwapConnector;
  readonly orderFeed: GetNextOrder;
  readonly chains: { [key in ChainId]?: SupportedChainConfig };
  readonly buckets: TokensBucket[];
  readonly client: PMMClient;
}

export class Executor implements ExecutorConf {
  tokenPriceService: PriceTokenService;
  swapConnector: SwapConnector;
  orderFeed: GetNextOrder;
  chains: { [key in ChainId]?: SupportedChainConfig } = {};
  buckets: TokensBucket[] = [];
  client: PMMClient;

  private isInitialized = false;
  private pmmClient: PMMClient;
  private readonly url1Inch = 'https://nodes.debridge.finance';

  constructor(
    private readonly logger: Logger,
    private readonly orderFulfilledMap: Map<string, boolean>,
  ) { }

  async init(config: ExecutorLaunchConfig) {
    if (this.isInitialized) return;

    this.tokenPriceService = config.tokenPriceService || new CoingeckoPriceFeed();

    if (config.swapConnector) {
      throw new Error("Custom swapConnector not implemented");
    }
    const oneInchConnector = new OneInchConnector(this.url1Inch);
    const jupiterConnector = new JupiterWrapper();
    this.swapConnector = new SwapConnectorImpl(oneInchConnector, jupiterConnector);

    this.buckets = config.buckets;

    const clients: { [key in number]: any } = {}
    await Promise.all(
      config.chains.map(async (chain) => {
        this.logger.info(`initializing ${ChainId[chain.chain]}...`)

        let client, unlockProvider, fulfullProvider;
        if (chain.chain === ChainId.Solana) {
          const solanaConnection = new Connection(chain.chainRpc);
          const solanaPmmSrc = new PublicKey(chain.environment?.pmmSrc || PRODUCTION.chains[ChainId.Solana]!.pmmSrc!);
          const solanaPmmDst = new PublicKey(chain.environment?.pmmDst || PRODUCTION.chains[ChainId.Solana]!.pmmDst!);
          const solanaDebridge = new PublicKey(
            chain.environment?.deBridgeContract || PRODUCTION.chains![ChainId.Solana]!.deBridgeContract!
          );
          const solanaDebridgeSetting = new PublicKey(
            chain.environment?.solana?.debridgeSetting || PRODUCTION.chains![ChainId.Solana]!.solana!.debridgeSetting!
          );

          const decodeKey = (key: string) => Keypair.fromSecretKey(
            chain.takerPrivateKey.startsWith("0x") ?
              helpers.hexToBuffer(key) : bs58.decode(key)
          );
          fulfullProvider = new SolanaProviderAdapter(solanaConnection, decodeKey(chain.takerPrivateKey))
          unlockProvider = new SolanaProviderAdapter(solanaConnection, decodeKey(chain.unlockAuthorityPrivateKey))

          client = new Solana.PmmClient(
            solanaConnection,
            solanaPmmSrc,
            solanaPmmDst,
            solanaDebridge,
            solanaDebridgeSetting
          );
          // TODO: wait until solana enables getProgramAddress with filters for ALT and init ALT if needed
          await client.initForFulfillPreswap(new PublicKey(chain.beneficiary), [], jupiterConnector);
        }
        else {
          const web3UnlockAuthority = createWeb3WithPrivateKey(chain.chainRpc, chain.unlockAuthorityPrivateKey);
          unlockProvider = new EvmAdapterProvider(web3UnlockAuthority);

          const web3Fulfill = createWeb3WithPrivateKey(chain.chainRpc, chain.unlockAuthorityPrivateKey);
          fulfullProvider= new EvmRebroadcastAdapterProviderAdapter(web3Fulfill, chain.environment?.evm?.evmRebroadcastAdapterOpts);

          client = new Evm.PmmEvmClient({
            enableContractsCache: true,
            addresses: {
              [chain.chain]: {
                pmmSourceAddress: chain.environment?.pmmSrc || PRODUCTION.defaultEvmAddresses?.pmmSrc || PRODUCTION.chains[chain.chain]?.pmmSrc,
                pmmDestinationAddress: chain.environment?.pmmDst || PRODUCTION.defaultEvmAddresses?.pmmDst || PRODUCTION.chains[chain.chain]?.pmmDst,
                deBridgeGateAddress: chain.environment?.deBridgeContract || PRODUCTION.defaultEvmAddresses?.deBridgeContract || PRODUCTION.chains[chain.chain]?.deBridgeContract,
                crossChainForwarderAddress: chain.environment?.evm?.forwarderContract || PRODUCTION.defaultEvmAddresses?.evm?.forwarderContract || PRODUCTION.chains[chain.chain]?.evm?.forwarderContract
              }
            },
          });
        }

        const processorInitializer = chain.orderProcessor || config.orderProcessor || processors.processor(4)
        const initializingChain = {
          chain: chain.chain,
          chainRpc: chain.chainRpc,
          unlockProvider,
          fulfullProvider,
          client,
        };
        const orderProcessor = await processorInitializer(chain.chain, {
          chain: initializingChain,
          buckets: config.buckets,
          logger: this.logger,
        });

        // append global validators to the list of dstValidators
        const dstValidators = await Promise.all(
          [
            ...(chain.dstValidators || []),
            ...(config.validators || [])
          ].map(validator => validator(chain.chain, {
            chain: initializingChain,
            logger: this.logger
          }))
        );

        const srcValidators = await Promise.all(
          (chain.srcValidators || []).map(initializer => initializer(
            chain.chain, {
              chain: initializingChain,
              logger: this.logger
            }
          ))
        );

        this.chains[chain.chain] = {
          chain: chain.chain,
          chainRpc: chain.chainRpc,
          srcValidators,
          dstValidators,
          orderProcessor,
          unlockProvider,
          fulfullProvider,
          client,
          beneficiary: chain.beneficiary
        }

        clients[chain.chain] = client;

      })
    );

    this.client = this.pmmClient = new PMMClient(clients);

    let orderFeed = config.orderFeed as GetNextOrder;
    if (typeof orderFeed === "string" || !orderFeed) {
      orderFeed = new WsNextOrder(orderFeed);
    }
    orderFeed.setEnabledChains(Object.values(this.chains).map(chain => chain.chain));
    orderFeed.setLogger(this.logger);
    await orderFeed.init();
    this.orderFeed = orderFeed;


    this.isInitialized = true;
  }

  async execute() {
    if (!this.isInitialized) throw new Error("executor is not initialized");

    try {
      const nextOrderInfo = await (
        this.orderFeed as WsNextOrder
      ).getNextOrder();
      this.logger.info(
        `execute nextOrderInfo ${JSON.stringify(nextOrderInfo)}`
      );

      if (nextOrderInfo) {
        const orderId = nextOrderInfo.orderId;
        const logger = this.logger.child({ orderId });
        if (nextOrderInfo.type === "created") {
          logger.info(`execute ${orderId} processing is started`);
          await this.processing(nextOrderInfo, logger);
          logger.info(`execute ${orderId} processing is finished`);
        }
      }
    } catch (e) {
      this.logger.error(`Error in execution ${e}`);
      console.log(e)
    }
  }

  private async processing(
    nextOrderInfo: NextOrderInfo,
    logger: Logger
  ): Promise<boolean> {
    const {
      order,
      orderId
    } = nextOrderInfo;
    if (!order || !orderId) throw new Error("Order is undefined")

    const takeChain = this.chains[order.take.chainId];
    if (!takeChain) throw new Error(`${ChainId[order.take.chainId]} not configured, skipping order`)

    const giveChain = this.chains[order.give.chainId];
    if (!giveChain) throw new Error(`${ChainId[order.give.chainId]} not configured, skipping order`);

    // to accept an order, all validators must approve the order.
    // executor invokes three groups of validators:
    // 1) defined globally (config.validators)
    // 2) defined as dstValidators under the takeChain config
    // 3) defined as srcValidators under the giveChain config

    // global validators
    const listOrderValidators = [];

    // dstValidators@takeChain
    if (takeChain.dstValidators && takeChain.dstValidators.length > 0) {
      listOrderValidators.push(...takeChain.dstValidators);
    }

    // srcValidators@giveChain
    if (
      giveChain.srcValidators &&
      giveChain.srcValidators.length > 0
    ) {
      listOrderValidators.push(...giveChain.srcValidators);
    }

    //
    // run validators
    //
    logger.info("Order validation is started");
    const orderValidators = await Promise.all(
      listOrderValidators.map((validator) => validator(order, {
            logger,
            config: this,
            giveChain,
            takeChain
          })
        )
    );

    if (!orderValidators.every((it) => it)) {
      logger.info("Order validation is failed");
      return false;
    }
    logger.info("Order validation is finished");

    //
    // run processor
    //
    logger.info(`OrderProcessor is started`);
    await takeChain.orderProcessor.process(
      orderId,
      order,
      {
        orderFulfilledMap: this.orderFulfilledMap,
        logger,
        config: this,
        giveChain,
        takeChain
      }
    );
    logger.info(`OrderProcessor is finished`);

    return true;
  }
}
