import {ChainConfig, ExecutorConfig} from "./config";
import {NextOrderInfo} from "./interfaces";
import {ChainId, Evm, PMMClient, Solana} from "@debridge-finance/pmm-client";
import logger from "loglevel";
import {CoingeckoPriceFeed} from "./priceFeeds/coingecko.price.feed";
import {OneInchConnector} from "./swapConnector/one.inch.connector";
import {Connection, PublicKey} from "@solana/web3.js";
import {Logger} from "pino";

export class Executor {
  private isInitialized = false;
  private solanaConnection: Connection;
  private pmmClient: PMMClient;

  constructor(private readonly config: ExecutorConfig, private readonly orderFulfilledMap: Map<string, boolean>, private readonly logger: Logger) {
  }

  async init() {
    if (this.isInitialized) return;
    const clients = {} as any;
    const evmAddresses = {} as any;
    const chains = await Promise.all(this.config.fulfillableChains.map(async chain => {
      const chainId = chain.chain;
      if (chainId === ChainId.Solana) {
        this.solanaConnection = new Connection(chain.chainRpc);

        const solanaPmmSrc = new PublicKey(chain.pmmSrc!);
        const solanaPmmDst = new PublicKey(chain.pmmDst!);
        const solanaDebridge = new PublicKey(chain.deBridgeSettings!.debridge!);
        const solanaDebridgeSetting = new PublicKey(chain.deBridgeSettings!.setting!);

        clients[chainId] = new Solana.PmmClient(
          this.solanaConnection,
          solanaPmmSrc,
          solanaPmmDst,
          solanaDebridge,
          solanaDebridgeSetting,
        );
        await clients[chainId].initForFulfillPreswap(chain.beneficiary, [ChainId.BSC, ChainId.Polygon]);
      } else {
        evmAddresses[chainId] = {
          pmmSourceAddress: chain.pmmSrc,
          pmmDestinationAddress: chain.pmmDst,
          deBridgeGateAddress: chain.deBridge,
          crossChainForwarderAddress: chain.crossChainForwarderAddress,
        };
      }
      return chainId;
    }));

    Object.keys(evmAddresses).forEach(address => {
      clients[address] = new Evm.PmmEvmClient({
        enableContractsCache: true,
        addresses: evmAddresses,
      });
    });

    this.pmmClient = new PMMClient(clients);

    if (!this.config.priceTokenService) {
      this.config.priceTokenService = new CoingeckoPriceFeed();
    }

    if (!this.config.swapConnector) {
      this.config.swapConnector = new OneInchConnector();
    }

    this.config.orderFeed.setEnabledChains(chains);

    this.isInitialized = true;
  }

  async execute() {
    if (!this.isInitialized) throw new Error('executor is not initialized');

    try {
      const nextOrderInfo = await this.config.orderFeed.getNextOrder();
      logger.log(`execute nextOrderInfo ${JSON.stringify(nextOrderInfo)}`);

      if (nextOrderInfo) {
        const orderId = nextOrderInfo.orderId;
        const logger = this.logger.child({ orderId });
        if (nextOrderInfo.type === 'created') {
          logger.info(`execute ${orderId} processing is started`);
          const fulfillableChainConfig = this.config.fulfillableChains.find(it => nextOrderInfo.order?.take.chainId === it.chain);
          await this.processing(nextOrderInfo, fulfillableChainConfig!, logger);
          logger.info(`execute ${orderId} processing is finished`);
        } else if(nextOrderInfo.type === 'fulfilled') {
          this.orderFulfilledMap.set(orderId, true);
        }
      }
    } catch (e) {
      logger.error(`Error in execution ${e}`);
    }
  }

  private async processing(nextOrderInfo: NextOrderInfo, fulfillableChainConfig: ChainConfig, logger: Logger): Promise<boolean> {
    const order = nextOrderInfo.order!;

    logger.info('Order validation is started');
    const orderValidators = await Promise.all(fulfillableChainConfig.orderValidators?.map(validator => {
      return validator(order, this.config, {
        client: this.pmmClient,
        logger,
      }) as Promise<boolean>;
    }) || []);

    if (!orderValidators.every(it => it)) {
      logger.info('Order validation is failed');
      return false;
    }
    logger.info('Order validation is finished');

    logger.info(`OrderProcessor is started`);
    await fulfillableChainConfig.orderProcessor!(nextOrderInfo.orderId, nextOrderInfo.order!, this.config, fulfillableChainConfig, {
      orderFulfilledMap: this.orderFulfilledMap,
      client: this.pmmClient,
      logger,
    });
    logger.info(`OrderProcessor is finished`);

    return true;
  }
}
