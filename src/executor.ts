/* eslint-disable no-await-in-loop -- Intentional because works only during initialization */

import crypto from 'crypto';
import {
  Address,
  ChainEngine,
  ChainId,
  ClientImplementation,
  CoingeckoPriceFeed,
  CommonDlnClient,
  Evm,
  getEngineByChainId,
  Jupiter,
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
  avgBlockSpeed,
} from './config';
import * as filters from './filters/index';
import { OrderFilter } from './filters/index';
import { Authority, GetNextOrder, IncomingOrder, OrderInfoStatus } from './interfaces';
import { WsNextOrder } from './orderFeeds/ws.order.feed';
import { EvmTxSigner } from './chain-evm/signer';
import { SolanaTxSigner } from './chain-solana/signer';
import { HooksEngine } from './hooks/HooksEngine';
import { ThroughputController } from './processors/throughput';
import { TVLBudgetController } from './processors/TVLBudgetController';
import { DataStore } from './processors/DataStore';
import { createClientLogger, DlnClient } from './dln-ts-client.utils';
import { getCurrentEnvironment } from './environments';
import { OrderProcessor } from './processor';
import { CommonTransactionBuilder, ITransactionBuilder } from './chain-common/tx-builder';
import { SolanaTransactionBuilder } from './chain-solana/tx-builder';
import { EvmTransactionBuilder } from './chain-evm/tx-builder';
import { SwapConnectorImplementationService } from './processors/swap-connector-implementation.service';
import { ForDefiTransactionBuilder } from './authority-forDefi/tx-builder';
import { ForDefiSigner } from './authority-forDefi/signer';
import { ForDefiClient } from './authority-forDefi/client';
import { EvmForDefiTransactionAdapter } from './chain-evm/fordefi-adapter';
import { SolanaForDefiTransactionAdapter } from './chain-solana/fordefi-adapter';
import { EmptyTransactionBuilder } from './chain-common/tx-builder-disabled';
import { isValidEvmAddress } from './chain-evm/utils';
import { die } from './errors';

const DEFAULT_MIN_PROFITABILITY_BPS = 4;

type EvmClientChainConfig = ConstructorParameters<typeof Evm.DlnClient>[0]['chainConfig'];

const safeExec = async (func: () => Promise<any>, error: string) => {
  try {
    return await func();
  } catch (e) {
    throw new Error(`${error}: ${e}`);
  }
};

export type DstOrderConstraints = Readonly<{
  fulfillmentDelay: number;
  preFulfillSwapChangeRecipient: 'taker' | 'maker';
}>;

export type DstConstraintsPerOrderValue = DstOrderConstraints &
  Readonly<{
    minBlockConfirmations: number;
  }>;

export type SrcConstraints = Readonly<{
  TVLBudget: number;
  profitability: number;
  batchUnlockSize: number;
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
  disabledFulfill: boolean;
  connection: any;
  network: {
    avgBlockSpeed: number;
    finalizedBlockCount: number;
  };
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
      perOrderValue: Array<DstConstraintsPerOrderValue>;
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
  swapConnector: SwapConnectorImplementationService;

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

  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({
      service: Executor.name,
    });
  }

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
    const evmChainConfig: EvmClientChainConfig = {};
    for (const chain of config.chains) {
      this.logger.info(`initializing ${ChainId[chain.chain]}...`);

      if (!SupportedChain[chain.chain]) {
        throw new Error(`${ChainId[chain.chain]} is not supported, remove it from the config`);
      }

      // convert old-fashioned takerPrivateKey to the new fulfillAuthority
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
        delete chain.takerPrivateKey;
      }

      // convert old-fashioned unlockAuthorityPrivateKey to the new unlockAuthority
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
        delete chain.unlockAuthorityPrivateKey;
      }

      let transactionBuilder: ITransactionBuilder;
      let client;
      let connection: Web3 | Connection;
      let contractsForApprove: string[] = [];
      let unlockBeneficiary: Uint8Array;

      if (chain.chain === ChainId.Solana) {
        connection = new Connection(chain.chainRpc, {
          // force using native fetch because node-fetch throws errors on some RPC providers sometimes
          fetch,
          commitment: 'confirmed',
        });

        this.swapConnector.setConnector(
          ChainId.Solana,
          new Jupiter.JupiterConnectorV6(
            connection,
            config.jupiterConfig?.apiToken,
            config.jupiterConfig?.maxAccounts || 16,
            config.jupiterConfig?.blacklistedDexes || [],
          ),
        );

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

        client = new Solana.DlnClient(
          connection,
          solanaPmmSrc,
          solanaPmmDst,
          solanaDebridge,
          solanaDebridgeSetting,
          undefined,
          undefined,
          getCurrentEnvironment().environment,
        );

        if (chain.disableFulfill) {
          this.logger.warn(
            `Chain ${
              ChainId[chain.chain]
            } is disabled: orders coming to this chain would be ignored, but orders coming from it to other enabled chains would be accepted for evaluation`,
          );
          transactionBuilder = new EmptyTransactionBuilder(chain.chain);
        } else {
          if (!chain.fulfillAuthority) {
            throw new Error(
              `fulfillAuthority is not set for ${
                ChainId[chain.chain]
              }. Did you forget to set disabled:true for this chain?`,
            );
          }

          const fulfillBuilder = await this.getSolanaProvider(
            'fulfill',
            chain,
            client,
            connection,
            chain.fulfillAuthority,
          );
          const initBuilder = chain.initAuthority
            ? await this.getSolanaProvider('init', chain, client, connection, chain.initAuthority)
            : fulfillBuilder;
          const unlockBuilder = chain.unlockAuthority
            ? await this.getSolanaProvider(
                'unlock',
                chain,
                client,
                connection,
                chain.unlockAuthority,
              )
            : fulfillBuilder;

          transactionBuilder = new CommonTransactionBuilder(
            initBuilder,
            fulfillBuilder,
            unlockBuilder,
          );
        }

        clients.push(client);

        unlockBeneficiary = await safeExec(async () => {
          const buffer = tokenStringToBuffer(chain.chain, chain.beneficiary);
          if (buffer.length !== 32) throw new Error();
          return buffer;
        }, `Invalid beneficiary for ${ChainId[chain.chain]}`);
      } else {
        connection = new Web3(chain.chainRpc);

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

        contractsForApprove = [
          evmChainConfig[chain.chain]!.dlnDestinationAddress,
          evmChainConfig[chain.chain]!.crossChainForwarderAddress,
        ];

        if (chain.initAuthority)
          throw new Error('initAuthority is not supported for EVM-based chains');

        if (chain.disableFulfill) {
          this.logger.warn(
            `Chain ${
              ChainId[chain.chain]
            } is disabled: orders coming to this chain would be ignored, but orders coming from it to other enabled chains would be accepted for evaluation`,
          );
          transactionBuilder = new EmptyTransactionBuilder(chain.chain);
        } else {
          if (!chain.fulfillAuthority) {
            throw new Error(
              `fulfillAuthority is not set for ${
                ChainId[chain.chain]
              }. Did you forget to set disabled:true for this chain?`,
            );
          }

          const fulfillBuilder = await this.getEVMProvider(
            'fulfill',
            chain,
            contractsForApprove,
            connection,
            chain.fulfillAuthority,
          );
          const unlockBuilder = chain.unlockAuthority
            ? await this.getEVMProvider('unlock', chain, [], connection, chain.unlockAuthority)
            : fulfillBuilder;
          transactionBuilder = new CommonTransactionBuilder(
            fulfillBuilder,
            fulfillBuilder,
            unlockBuilder,
          );
        }

        if (!isValidEvmAddress(chain.beneficiary))
          throw new Error(`Invalid beneficiary for ${ChainId[chain.chain]}`);
        unlockBeneficiary = tokenStringToBuffer(chain.chain, chain.beneficiary);
      }

      const dstFiltersInitializers = chain.dstFilters || [];
      if (chain.disableFulfill) {
        dstFiltersInitializers.push(filters.disableFulfill());
      }

      // append global filters to the list of dstFilters

      const dstFilters = await Promise.all(
        [...dstFiltersInitializers, ...(config.filters || [])].map((filter) =>
          filter(chain.chain, {
            logger: this.logger,
          }),
        ),
      );

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
        disabledFulfill: chain.disableFulfill || false,
        connection,
        network: {
          avgBlockSpeed: avgBlockSpeed[chain.chain as unknown as SupportedChain],
          finalizedBlockCount:
            BLOCK_CONFIRMATIONS_HARD_CAPS[chain.chain as unknown as SupportedChain],
        },
        srcFilters,
        dstFilters,
        unlockAuthority: transactionBuilder.fulfillAuthority,
        fulfillAuthority: transactionBuilder.unlockAuthority,
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
        unlockBeneficiary,
        srcConstraints,
        dstConstraints: {
          ...Executor.getDstConstraints(chain.dstConstraints || {}),
          perOrderValue: Executor.getDstConstraintsPerOrderValue(chain.dstConstraints || {}),
        },
      };

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

    const unlockAuthorities = Object.values(this.chains)
      .filter((chain) => !chain.disabledFulfill)
      .map((chain) => ({
        chainId: chain.chain,
        address: chain.unlockAuthority.address,
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
      (event) => this.execute(event),
      unlockAuthorities,
      minConfirmationThresholds,
      this.hookEngine,
    );

    // Override internal slippage calculation: do not reserve slippage buffer for pre-fulfill swap
    setSlippageOverloader(() => 0);

    this.#isInitialized = true;
  }

  private async getEVMProvider(
    type: 'fulfill' | 'unlock',
    chain: ChainDefinition,
    contracts: string[],
    connection: Web3,
    authority: SignerAuthority,
  ): Promise<ITransactionBuilder> {
    switch (authority.type) {
      case 'PK': {
        if (!EvmTxSigner.isValidPrivateKey(authority.privateKey)) {
          throw new Error(
            `Invalid private key given for ${type} authority on ${ChainId[chain.chain]}`,
          );
        }

        return new EvmTransactionBuilder(
          chain.chain,
          contracts,
          connection,
          new EvmTxSigner(
            chain.chain,
            connection,
            authority.privateKey,
            chain.environment?.evm?.evmRebroadcastAdapterOpts,
          ),
          this,
        );
      }

      case 'ForDefi': {
        const signer = new ForDefiSigner(
          await safeExec(
            async () =>
              crypto.createPrivateKey({
                key: authority.signerPrivateKey,
                passphrase: authority.privateKeyPassphrase,
              }),
            `Invalid private key given for ${type} authority on ${ChainId[chain.chain]}`,
          ),
          this.logger,
        );

        const client = new ForDefiClient(authority.accessToken, this.logger);

        const vaultAddress = await Executor.getVault(chain.chain, client, authority.vaultId);

        return new ForDefiTransactionBuilder(
          chain.chain,
          client,
          signer,
          new EvmForDefiTransactionAdapter(
            chain.chain,
            { id: authority.vaultId, address: vaultAddress },
            connection,
            this,
            contracts,
          ),
        );
      }

      default:
        throw new Error(
          `Unsupported authority "${(authority as any).type}" for ${ChainId[chain.chain]}`,
        );
    }
  }

  private static async getVault(
    chainId: ChainId,
    client: ForDefiClient,
    vaultId: string,
  ): Promise<Uint8Array> {
    const vault = await safeExec(
      async () => client.getVault(vaultId),
      `Unable to retrieve ForDefi vault ${vaultId} for ${ChainId[chainId]}`,
    );

    switch (getEngineByChainId(chainId)) {
      case ChainEngine.EVM: {
        if (vault.type !== 'evm')
          throw new Error(
            `Unexpected type of vault ${vaultId} for ${ChainId[chainId]}: expected "evm", but got "${vault.type}"`,
          );
        break;
      }
      case ChainEngine.Solana: {
        if (vault.type !== 'solana')
          throw new Error(
            `Unexpected type of vault ${vaultId} for ${ChainId[chainId]}: expected "solana", but got "${vault.type}"`,
          );
        break;
      }
      default:
        die(`Unexpected engine`);
    }

    return tokenStringToBuffer(chainId, vault.address);
  }

  private async getSolanaProvider(
    type: 'init' | 'fulfill' | 'unlock',
    chain: ChainDefinition,
    client: Solana.DlnClient,
    connection: Connection,
    authority: SignerAuthority,
  ): Promise<ITransactionBuilder> {
    switch (authority.type) {
      case 'PK': {
        return new SolanaTransactionBuilder(
          client,
          new SolanaTxSigner(
            connection,
            await safeExec(
              async () =>
                Keypair.fromSecretKey(
                  authority.privateKey.startsWith('0x')
                    ? helpers.hexToBuffer(authority.privateKey)
                    : bs58.decode(authority.privateKey),
                ),
              `Invalid private key given for ${type} authority on ${ChainId[chain.chain]}`,
            ),
          ),
          this,
        );
      }

      case 'ForDefi': {
        const forDefiClient = new ForDefiClient(authority.accessToken, this.logger);
        const vaultAddress = await Executor.getVault(chain.chain, forDefiClient, authority.vaultId);

        return new ForDefiTransactionBuilder(
          chain.chain,
          forDefiClient,
          new ForDefiSigner(
            await safeExec(
              async () =>
                crypto.createPrivateKey({
                  key: authority.signerPrivateKey,
                  passphrase: authority.privateKeyPassphrase,
                }),
              `Invalid private key given for ${type} authority on ${ChainId[chain.chain]}`,
            ),
            this.logger,
          ),
          new SolanaForDefiTransactionAdapter(
            { id: authority.vaultId, address: vaultAddress },
            this,
          ),
        );
      }

      default:
        throw new Error(
          `Unsupported authority "${(authority as any).type}" for ${ChainId[chain.chain]}`,
        );
    }
  }

  private static getDstConstraintsPerOrderValue(
    configDstConstraints: ChainDefinition['dstConstraints'],
  ): Array<DstConstraintsPerOrderValue> {
    return (configDstConstraints?.perOrderValueUpperThreshold || [])
      .map((constraint) => ({
        minBlockConfirmations: constraint.minBlockConfirmations,
        ...Executor.getDstConstraints(constraint, configDstConstraints),
      }))
      .sort(
        (constraintB, constraintA) =>
          constraintA.minBlockConfirmations - constraintB.minBlockConfirmations,
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
      batchUnlockSize:
        chainConstraint.batchUnlockSize || sharedConstraint.batchUnlockSize || maxBatchSize,
    };

    if (srcConstraints.batchUnlockSize < 1 || srcConstraints.batchUnlockSize > maxBatchSize) {
      throw new Error(
        `Unlock batch size is out of bounds: expected [1,${maxBatchSize}]; actual: ${srcConstraints.batchUnlockSize} for ${ChainId[chainId]}`,
      );
    }

    if (chainId === ChainId.Solana) {
      if (srcConstraints.batchUnlockSize > maxBatchSizeToSolana) {
        srcConstraints.batchUnlockSize = maxBatchSizeToSolana;
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

  private async execute(nextOrderInfo: IncomingOrder<any>) {
    const { orderId, order } = nextOrderInfo;
    this.logger.info(
      `📥 received order ${orderId} of status ${OrderInfoStatus[nextOrderInfo.status]}`,
    );

    const takeChain = this.chains[order.take.chainId];
    if (!takeChain) {
      this.logger.info(
        `dropping order ${nextOrderInfo.orderId} because take chain ${
          ChainId[order.take.chainId]
        } is not configured`,
      );
      return;
    }

    const giveChain = this.chains[order.give.chainId];
    if (!giveChain) {
      this.logger.info(
        `dropping order ${nextOrderInfo.orderId} because give chain ${
          ChainId[order.give.chainId]
        } is not configured`,
      );
      return;
    }

    //
    // run processor
    //
    this.processors[takeChain.chain]!.handleEvent({
      orderInfo: nextOrderInfo,
      giveChain,
      takeChain,
    });
  }
}
