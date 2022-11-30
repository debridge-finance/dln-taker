import { ChainId, Evm, PMMClient, Solana } from "@debridge-finance/dln-client";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Logger } from "pino";

import { ChainConfig, ExecutorConfig } from "./config";
import { GetNextOrder, NextOrderInfo } from "./interfaces";
import { WsNextOrder } from "./orderFeeds/ws.order.feed";
import { CoingeckoPriceFeed } from "./priceFeeds/coingecko.price.feed";
import { OneInchConnector } from "./swapConnector/one.inch.connector";
import { ProviderAdapter } from "./providers/provider.adapter";
import { EvmAdapterProvider } from "./providers/evm.provider.adapter";
import { createWeb3WithPrivateKey } from "./processors/utils/create.web3.with.private.key";
import { SolanaProviderAdapter } from "./providers/solana.provider.adapter";
import { helpers } from "@debridge-finance/solana-utils";
import { OrderValidatorInterface } from "./validators/order.validator.interface";
import { EvmRebroadcastAdapterProviderAdapter } from "./providers/evm.rebroadcast.adapter.provider.adapter";
import bs58 from "bs58";

export class Executor {
  private isInitialized = false;
  private solanaConnection: Connection;
  private pmmClient: PMMClient;
  private orderFeed: GetNextOrder;
  private providersForUnlock = new Map<ChainId, ProviderAdapter>();
  private providersForFulfill = new Map<ChainId, ProviderAdapter>();

  constructor(
    private readonly config: ExecutorConfig,
    private readonly orderFulfilledMap: Map<string, boolean>,
    private readonly logger: Logger
  ) { }

  async init() {
    if (this.isInitialized) return;
    this.configureProvidersMap();

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
            chain.environment?.solana!.debridgeSetting!
          );

          clients[chainId] = new Solana.PmmClient(
            this.solanaConnection,
            solanaPmmSrc,
            solanaPmmDst,
            solanaDebridge,
            solanaDebridgeSetting
          );
          // TODO: wait until solana enables getProgramAddress with filters for ALT and init ALT if needed
          await (clients[chainId] as Solana.PmmClient).initForFulfillPreswap(new PublicKey(chain.beneficiary), []);
        } else {
          // TODO all these addresses are optional, so we need to provide defaults which represent the mainnet setup
          evmAddresses[chainId] = {
            pmmSourceAddress: chain.environment?.pmmSrc,
            pmmDestinationAddress: chain.environment?.pmmDst,
            deBridgeGateAddress: chain.environment?.deBridgeContract,
            crossChainForwarderAddress: chain.environment?.evm?.forwarderContract
          };
        }

        // append global validators to the list of dstValidators
        chain.dstValidators = [
          ...(chain.dstValidators || []),
          ...(this.config.validators || [])
        ];

        const validatorsForInit = [
          ...(chain.srcValidators || []),
          ...(chain.dstValidators || [])
        ].filter(validator => validator instanceof OrderValidatorInterface)
        await Promise.all(validatorsForInit.map(validator => {
          return (validator as OrderValidatorInterface).init(chainId);
        }));

        await chain.orderProcessor!.init(chain.chain, {
          executorConfig: this.config,
          providersForFulfill: this.providersForFulfill,
          providersForUnlock: this.providersForUnlock,
          logger: this.logger,
        });

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
      console.log(e)
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
    const listOrderValidators = [];

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
        if (validator instanceof OrderValidatorInterface) {
          return validator.validate(order, this.config, {
            client: this.pmmClient,
            logger,
            providers: this.providersForUnlock,
          }) as Promise<boolean>;
        } else {
          return validator(order, this.config, {
            client: this.pmmClient,
            logger,
            providers: this.providersForUnlock,
          }) as Promise<boolean>;
        }
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

    await orderProcessor!.process(
      nextOrderInfo.orderId,
      nextOrderInfo.order!,
      this.config,
      {
        orderFulfilledMap: this.orderFulfilledMap,
        client: this.pmmClient,
        logger,
        providersForUnlock: this.providersForUnlock,
        providersForFulfill: this.providersForFulfill,
      }
    );
    logger.info(`OrderProcessor is finished`);

    return true;
  }

  private configureProvidersMap() {
    for (const chain of this.config.chains) {
      if (chain.chain !== ChainId.Solana) {
        const web3UnlockAuthority = createWeb3WithPrivateKey(chain.chainRpc, chain.unlockAuthorityPrivateKey);
        const web3Fulfill = createWeb3WithPrivateKey(chain.chainRpc, chain.unlockAuthorityPrivateKey);
        this.providersForUnlock.set(chain.chain, new EvmAdapterProvider(web3UnlockAuthority));
        this.providersForFulfill.set(chain.chain, new EvmRebroadcastAdapterProviderAdapter(web3Fulfill, chain.environment?.evm?.evmRebroadcastAdapterOpts));
      } else {
        const decodeKey = (key: string) => Keypair.fromSecretKey(
          chain.takerPrivateKey.startsWith("0x") ?
            helpers.hexToBuffer(key) : bs58.decode(key)
        )
        this.providersForFulfill.set(chain.chain, new SolanaProviderAdapter(this.solanaConnection, decodeKey(chain.takerPrivateKey)));
        this.providersForUnlock.set(chain.chain, new SolanaProviderAdapter(this.solanaConnection, decodeKey(chain.unlockAuthorityPrivateKey)));
      }
    }
  }
}
