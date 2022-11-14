import {ExecutorConfig, FulfillableChainConfig} from "./config";
import {NextOrderInfo} from "./interfaces";
import {ChainId, Evm, PMMClient, Solana} from "@debridge-finance/pmm-client";
import logger from "loglevel";
import {helpers} from "@debridge-finance/solana-utils";
import {CoingeckoPriceFeed} from "./priceFeeds/coingecko.price.feed";
import {OneInchConnector} from "./swapConnector/one.inch.connector";
import {Connection, PublicKey} from "@solana/web3.js";

export class Executor {
  private isInitialized = false;
  private solanaConnection: Connection;
  private pmmClient: PMMClient;

  constructor(private readonly config: ExecutorConfig) {
  }

  async init() {
    if (this.isInitialized) return;
    const clients = {} as any;
    const evmAddresses = {} as any;
    const chains = this.config.fulfillableChains.map(chain => {
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
      } else {
        evmAddresses[chainId] = {
          pmmSourceAddress: chain.pmmSrc,
          pmmDestinationAddress: chain.pmmDst,
          deBridgeGateAddress: chain.deBridge,
          crossChainForwarderAddress: chain.crossChainForwarderAddress,
        };
      }
      return chainId;
    });

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
        if (nextOrderInfo.type === 'created') {
          logger.log(`execute ${orderId} processing is started`);
          const fulfillableChainConfig = this.config.fulfillableChains.find(it => nextOrderInfo.order?.take.chainId === it.chain);
          if (Array.isArray(fulfillableChainConfig!.whitelistedGiveTokens)) {
            fulfillableChainConfig!.whitelistedGiveTokens = fulfillableChainConfig!.whitelistedGiveTokens!.map(it => {
              return it.toLowerCase();
            });
          }

          await this.processing(nextOrderInfo, fulfillableChainConfig!);

          logger.log(`execute ${orderId} processing is finished`);
        }
      }
    } catch (e) {
      logger.error(`Error in execution ${e}`);
    }
  }

  private async processing(nextOrderInfo: NextOrderInfo, fulfillableChainConfig: FulfillableChainConfig): Promise<boolean> {
    const order = nextOrderInfo.order!;
    const giveTokenAddress = helpers.bufferToHex(Buffer.from(order.give.tokenAddress));

    logger.log('Validation whitelistedGiveTokens is started');
    if (Array.isArray(fulfillableChainConfig.whitelistedGiveTokens) && !fulfillableChainConfig.whitelistedGiveTokens.includes(giveTokenAddress)) {
      logger.error('Validation whitelistedGiveTokens is failed');
      return false;
    }//todo move to validator
    logger.log('Validation whitelistedGiveTokens is finished');

    logger.log('Order validation is started');
    const orderValidators = await Promise.all(fulfillableChainConfig.orderValidators?.map(validator => {
      return validator(order, this.pmmClient, this.config) as Promise<boolean>;
    }) || []);

    if (!orderValidators.every(it => it)) {
      logger.error('Order validation is failed');
      return false;
    }
    logger.log('Order validation is finished');

    logger.log(`OrderProcessor is started`);
    await fulfillableChainConfig.orderProcessor!(nextOrderInfo.order!, this.config, fulfillableChainConfig, this.pmmClient);
    logger.log(`OrderProcessor is finished`);

    return true;
  }
}
