import {ChainId, Evm, PMMClient, Solana} from "@debridge-finance/pmm-client";
import {Connection, Keypair, PublicKey} from "@solana/web3.js";
import {Logger} from "pino";

import {ChainConfig, ExecutorConfig} from "./config";
import {GetNextOrder, NextOrderInfo} from "./interfaces";
import {WsNextOrder} from "./orderFeeds/ws.order.feed";
import {CoingeckoPriceFeed} from "./priceFeeds/coingecko.price.feed";
import {OneInchConnector} from "./swapConnector/one.inch.connector";
import {ProviderAdapter} from "./providers/provider.adapter";
import {EvmAdapterProvider} from "./providers/evm.provider.adapter";
import {createWeb3WithPrivateKey} from "./processors/utils/create.web3.with.private.key";
import {SolanaProviderAdapter} from "./providers/solana.provider.adapter";
import {helpers} from "@debridge-finance/solana-utils";

export class Executor {
  private isInitialized = false;
  private solanaConnection: Connection;
  private pmmClient: PMMClient;
  private orderFeed: GetNextOrder;
  private providersMap = new Map<ChainId, ProviderAdapter>();

  constructor(
    private readonly config: ExecutorConfig,
    private readonly orderFulfilledMap: Map<string, boolean>,
    private readonly logger: Logger
  ) {}

  async init() {
    if (this.isInitialized) return;
    const clients: { [key in ChainId]: Solana.PmmClient | Evm.PmmEvmClient } = {} as any;
    const evmAddresses: { [key in ChainId]: any } = {} as any;
    const chains = await Promise.all(
      this.config.chains.map(async (chain) => {
        const chainId = chain.chain;

        // console.log(chainId, chain.orderProcessor, this.config.orderProcessor)
        if (!chain.orderProcessor && !this.config.orderProcessor) {
          throw new Error(
            `OrderProcessor is specified neither globally (config.orderProcessor) nor for chain ${ChainId[chainId]} (config.chains.<bsc>.orderProcessor)`
          );
        }

        if (chainId === ChainId.Solana) {
          this.solanaConnection = new Connection(chain.chainRpc);

          const solanaPmmSrc = new PublicKey(chain.environment?.pmmSrc!);
          const solanaPmmDst = new PublicKey(chain.environment?.pmmDst!);
          const solanaDebridge = new PublicKey(
            chain.environment?.deBridgeContract!
          );
          const solanaDebridgeSetting = new PublicKey(
            chain.environment?.deBridgeContract!
          );

          clients[chainId] = new Solana.PmmClient(
            this.solanaConnection,
            solanaPmmSrc,
            solanaPmmDst,
            solanaDebridge,
            solanaDebridgeSetting
          );
          await (clients[chainId] as Solana.PmmClient).initForFulfillPreswap(new PublicKey(chain.beneficiary), [
            ChainId.BSC,
            ChainId.Polygon,
          ]);
        } else {
          // TODO all these addresses are optional, so we need to provide defaults which represent the mainnet setup
          evmAddresses[chainId] = {
            pmmSourceAddress: chain.environment?.pmmSrc,
            pmmDestinationAddress: chain.environment?.pmmDst,
            deBridgeGateAddress: chain.environment?.deBridgeContract,
            crossChainForwarderAddress: chain.environment?.evm?.forwarderContract
          };
        }
        return chainId;
      })
    );

    Object.keys(evmAddresses).forEach((chainId) => {
      clients[chainId as any as ChainId] = new Evm.PmmEvmClient({
        enableContractsCache: true,
        addresses: evmAddresses,
      });
    });

    this.pmmClient = new PMMClient(clients);

    if (!this.config.tokenPriceService) {
      this.config.tokenPriceService = new CoingeckoPriceFeed();
    }

    if (!this.config.swapConnector) {
      this.config.swapConnector = new OneInchConnector();
    }

    let orderFeed = this.config.orderFeed;
    if (typeof orderFeed === "string") {
      orderFeed = new WsNextOrder(orderFeed);
    }
    orderFeed.setEnabledChains(chains);
    orderFeed.setLogger(this.logger);
    await orderFeed.init();
    this.orderFeed = orderFeed;

    this.configureProvidersMap();

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
          const chainConfig = this.config.chains.find(
            (it) => nextOrderInfo.order?.take.chainId === it.chain
          );
          await this.processing(nextOrderInfo, chainConfig!, logger);
          logger.info(`execute ${orderId} processing is finished`);
        } else if (nextOrderInfo.type === "fulfilled") {
          this.orderFulfilledMap.set(orderId, true);
        }
      }
    } catch (e) {
      this.logger.error(`Error in execution ${e}`);
    }
  }

  private async processing(
    nextOrderInfo: NextOrderInfo,
    chainConfig: ChainConfig,
    logger: Logger
  ): Promise<boolean> {
    const order = nextOrderInfo.order!;

    // to accept an order, all validators must approve the order.
    // executor invokes three groups of validators:
    // 1) defined globally (config.validators)
    // 2) defined as dstValidators under the takeChain config
    // 3) defined as srcValidators under the giveChain config

    // global validators
    const listOrderValidators = this.config.validators || [];

    // dstValidators@takeChain
    if (chainConfig.dstValidators && chainConfig.dstValidators.length > 0) {
      listOrderValidators.push(...chainConfig.dstValidators);
    }

    // srcValidators@giveChain
    const giveChainConfig = this.config.chains.find(
      (chain) => chain.chain === order.give.chainId
    )!;
    if (
      giveChainConfig.srcValidators &&
      giveChainConfig.srcValidators.length > 0
    ) {
      listOrderValidators.push(...giveChainConfig.srcValidators);
    }

    //
    // run validators
    //
    logger.info("Order validation is started");
    const orderValidators = await Promise.all(
      listOrderValidators.map((validator) => {
        return validator(order, this.config, {
          client: this.pmmClient,
          logger,
          providers: this.providersMap,
        }) as Promise<boolean>;
      }) || []
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
    const orderProcessor =
      chainConfig.orderProcessor || this.config.orderProcessor;

    await orderProcessor!(
      nextOrderInfo.orderId,
      nextOrderInfo.order!,
      this.config,
      {
        orderFulfilledMap: this.orderFulfilledMap,
        client: this.pmmClient,
        logger,
        providers: this.providersMap,
      }
    );
    logger.info(`OrderProcessor is finished`);

    return true;
  }

  private configureProvidersMap() {
    for (const chain of this.config.chains) {
      let provider: ProviderAdapter;
      if (chain.chain === ChainId.Solana) {
        provider = new EvmAdapterProvider(createWeb3WithPrivateKey(chain.chainRpc, chain.takerPrivateKey));
      } else {
        provider = new SolanaProviderAdapter(this.solanaConnection, Keypair.fromSecretKey(
          helpers.hexToBuffer(chain.takerPrivateKey)
        ));
      }
      this.providersMap.set(chain.chain, provider);
    }
  }
}
