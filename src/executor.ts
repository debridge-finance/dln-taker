import { ChainId, Evm, PMMClient, Solana } from "@debridge-finance/pmm-client";
import { Connection, PublicKey } from "@solana/web3.js";
import { Logger } from "pino";

import { ChainConfig, ExecutorConfig } from "./config";
import { NextOrderInfo } from "./interfaces";
import { WsNextOrder } from "./orderFeeds/ws.order.feed";
import { CoingeckoPriceFeed } from "./priceFeeds/coingecko.price.feed";
import { OneInchConnector } from "./swapConnector/one.inch.connector";

export class Executor {
  private isInitialized = false;
  private solanaConnection: Connection;
  private pmmClient: PMMClient;

  constructor(
    private readonly config: ExecutorConfig,
    private readonly orderFulfilledMap: Map<string, boolean>,
    private readonly logger: Logger
  ) {}

  async init() {
    if (this.isInitialized) return;
    const clients = {} as any;
    const evmAddresses = {} as any;
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

          const solanaPmmSrc = new PublicKey(chain.pmmSrc!);
          const solanaPmmDst = new PublicKey(chain.pmmDst!);
          const solanaDebridge = new PublicKey(
            chain.deBridgeSettings!.debridge!
          );
          const solanaDebridgeSetting = new PublicKey(
            chain.deBridgeSettings!.setting!
          );

          clients[chainId] = new Solana.PmmClient(
            this.solanaConnection,
            solanaPmmSrc,
            solanaPmmDst,
            solanaDebridge,
            solanaDebridgeSetting
          );
          await clients[chainId].initForFulfillPreswap(chain.beneficiary, [
            ChainId.BSC,
            ChainId.Polygon,
          ]);
        } else {
          evmAddresses[chainId] = {
            pmmSourceAddress: chain.pmmSrc,
            pmmDestinationAddress: chain.pmmDst,
            deBridgeGateAddress: chain.deBridge,
            crossChainForwarderAddress: chain.crossChainForwarderAddress,
          };
        }
        return chainId;
      })
    );

    Object.keys(evmAddresses).forEach((address) => {
      clients[address] = new Evm.PmmEvmClient({
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

    if (typeof this.config.orderFeed === "string") {
      this.config.orderFeed = new WsNextOrder(this.config.orderFeed);
    }
    this.config.orderFeed.setEnabledChains(chains);
    this.config.orderFeed.setLogger(this.logger);
    await this.config.orderFeed.init();

    this.isInitialized = true;
  }

  async execute() {
    if (!this.isInitialized) throw new Error("executor is not initialized");

    try {
      const nextOrderInfo = await (
        this.config.orderFeed as WsNextOrder
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

    const listOrderValidators = this.config.orderValidators || [];
    if (chainConfig.dstValidators && chainConfig.dstValidators.length > 0) {
      listOrderValidators?.push(...chainConfig.dstValidators);
    }

    const giveChainConfig = this.config.chains.find(
      (chain) => chain.chain === order.give.chainId
    )!;
    if (
      giveChainConfig.srcValidators &&
      giveChainConfig.srcValidators.length > 0
    ) {
      listOrderValidators?.push(...giveChainConfig.srcValidators);
    }

    logger.info("Order validation is started");
    const orderValidators = await Promise.all(
      listOrderValidators.map((validator) => {
        return validator(order, this.config, {
          client: this.pmmClient,
          logger,
        }) as Promise<boolean>;
      }) || []
    );

    if (!orderValidators.every((it) => it)) {
      logger.info("Order validation is failed");
      return false;
    }
    logger.info("Order validation is finished");

    logger.info(`OrderProcessor is started`);
    const orderProcessor =
      chainConfig.orderProcessor || this.config.orderProcessor;

    await orderProcessor!(
      nextOrderInfo.orderId,
      nextOrderInfo.order!,
      this.config,
      chainConfig,
      {
        orderFulfilledMap: this.orderFulfilledMap,
        client: this.pmmClient,
        logger,
      }
    );
    logger.info(`OrderProcessor is finished`);

    return true;
  }
}
