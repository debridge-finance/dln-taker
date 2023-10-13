import {
  ChainEngine,
  ChainId,
  EvmInstruction,
  getEngineByChainId,
  tokenAddressToString,
} from '@debridge-finance/dln-client';
import { VersionedTransaction } from '@solana/web3.js';
import {IncomingOrder, IncomingOrderContext, OrderId, OrderInfoStatus } from './interfaces';
import { EvmProviderAdapter, InputTransaction } from './providers/evm.provider.adapter';
import { BatchUnlocker } from './processors/BatchUnlocker';
import { MempoolService } from './processors/mempool.service';
import { PostponingReason, RejectionReason } from './hooks/HookEnums';
import { isRevertedError } from './processors/utils/isRevertedError';
import { IExecutor, ExecutorSupportedChain } from './executor';
import { assert, die } from './errors';
import { CreatedOrder } from './chain-common/order'
import { OrderEstimator } from 'src/chain-common/order-estimator';
import { Logger } from 'pino';
import { OrderValidation, OrderValidationResult } from './chain-common/order-validator';

// Represents all necessary information about Created order during its internal lifecycle
type CreatedOrderMetadata = {
  readonly orderId: OrderId;
  readonly arrivedAt: Date;
  attempts: number;
  context: IncomingOrderContext;
};

export type OrderProcessorInitContext = {
  logger: Logger;
  contractsForApprove: string[];
};

export class OrderProcessor {
  readonly #mempoolService: MempoolService;
  readonly #batchUnlocker: BatchUnlocker;
  readonly #logger: Logger;

  private priorityQueue = new Set<OrderId>(); // queue of orderid for processing created order
  private queue = new Set<OrderId>(); // queue of orderid for retry processing order
  private eventsQueue = new Array<IncomingOrderContext>();
  private isLocked: boolean = false;
  readonly #createdOrdersMetadata = new Map<OrderId, CreatedOrderMetadata>();

  private constructor(
    private readonly takeChain: ExecutorSupportedChain,
    private readonly executor: IExecutor,
    context: OrderProcessorInitContext
  ) {
      this.#logger = context.logger.child({
        takeChainId: takeChain.chain,
      });

      this.#batchUnlocker = new BatchUnlocker(
        this.#logger,
        executor,
        this.takeChain,
      );

      this.#mempoolService = new MempoolService(
        this.#logger,
        (orderId: string) => this.handleOrder(orderId),
      );
  }

  public static async initialize(
    takeChain: ExecutorSupportedChain,
    executor: IExecutor,
    context: OrderProcessorInitContext): Promise<OrderProcessor> {
    const me = new OrderProcessor(takeChain, executor, context);
    return me.init(context.contractsForApprove);
  }

  private async init(
    contractsForApprove: string[]
  ): Promise<OrderProcessor> {
    if (this.takeChain.chain !== ChainId.Solana) {
      const tokens: string[] = [];
      this.executor.buckets.forEach((bucket) => {
        const tokensFromBucket = bucket.findTokens(this.takeChain.chain) || [];
        tokensFromBucket.forEach((token) => {
          tokens.push(tokenAddressToString(this.takeChain.chain, token));
        });
      });

      const evmProvider = this.takeChain.fulfillProvider as EvmProviderAdapter;
      for (const token of tokens) {
        for (const contract of contractsForApprove) {
          // eslint-disable-next-line no-await-in-loop -- Intentional because works only during initialization
          await evmProvider.approveToken(token, contract, this.#logger);
        }
      }
    }

    return this;
  }

  private handleOrder(orderId: string): void {
    this.process(this.getCreatedOrderMetadata(orderId).context);
  }

  handleEvent(context: IncomingOrderContext): void {
    const { status, orderId } = context.orderInfo;

    // creation events must be tracked in a separate storage
    if ([OrderInfoStatus.Created, OrderInfoStatus.ArchivalCreated].includes(status)) {
      if (this.#createdOrdersMetadata.has(orderId)) {
        this.#createdOrdersMetadata.get(orderId)!.context = context;
      } else {
        this.#createdOrdersMetadata.set(orderId, {
          orderId,
          arrivedAt: new Date(),
          attempts: 0,
          context,
        });
      }
    }

    this.process(context);
  }

  private clearInternalQueues(orderId: string): void {
    this.queue.delete(orderId);
    this.priorityQueue.delete(orderId);
    this.#mempoolService.delete(orderId);
  }

  private clearOrderStore(orderId: string): void {
    this.#createdOrdersMetadata.delete(orderId);
  }

  private async process(context: IncomingOrderContext): Promise<void> {
    const { status, orderId } = context.orderInfo;
    const { context: orderContext } = context;

    // already processing an order
    if (this.isLocked) {
      orderContext.logger.debug(`Processor is currently processing an order, postponing`);

      switch (status) {
        case OrderInfoStatus.ArchivalCreated: {
          this.queue.add(orderId);
          orderContext.logger.debug(`postponed to secondary queue`);
          break;
        }
        case OrderInfoStatus.Created: {
          this.priorityQueue.add(orderId);
          orderContext.logger.debug(`postponed to primary queue`);
          break;
        }
        default: {
          orderContext.logger.debug(`postponed to event queue`);
          this.eventsQueue.push(context);
        }
      }

      return;
    }

    this.isLocked = true;
    switch (status) {
      case OrderInfoStatus.Created:
      case OrderInfoStatus.ArchivalCreated: {
        const metadata = this.getCreatedOrderMetadata(context.orderInfo.orderId);
        try {
          metadata.attempts++;
          await this.evaluateAndFulfill(metadata);
        } catch (e) {
          const message = `processing order failed with an unhandled error: ${e}`;
          orderContext.logger.error(message);
          orderContext.logger.error(e);
          this.postponeOrder(metadata, message, PostponingReason.UNHANDLED_ERROR);
        }

        break;
      }
      case OrderInfoStatus.ArchivalFulfilled: {
        this.#batchUnlocker.unlockOrder(orderId, context.orderInfo.order, orderContext);
        break;
      }
      case OrderInfoStatus.Cancelled: {
        this.clearInternalQueues(orderId);
        this.clearOrderStore(orderId);
        orderContext.logger.debug(`deleted from queues`);
        break;
      }
      case OrderInfoStatus.Fulfilled: {
        this.clearInternalQueues(orderId);
        this.clearOrderStore(orderId);
        orderContext.giveChain.TVLBudgetController.flushCache();
        orderContext.takeChain.TVLBudgetController.flushCache();
        orderContext.logger.debug(`deleted from queues`);

        this.#batchUnlocker.unlockOrder(orderId, context.orderInfo.order, orderContext);
        break;
      }
      default: {
        orderContext.logger.debug(`status=${OrderInfoStatus[status]} not implemented, skipping`);
      }
    }
    this.isLocked = false;

    if (this.eventsQueue.length > 0) {
      this.handleEvent(this.eventsQueue.shift()!);
      return;
    }

    const nextOrderId = this.pickNextOrderId();
    if (nextOrderId) {
      this.handleOrder(nextOrderId);
    }
  }

  private pickNextOrderId(): OrderId | undefined {
    const nextOrderId =
      this.priorityQueue.values().next().value || this.queue.values().next().value;

    if (!nextOrderId) {
      return undefined;
    }
    this.priorityQueue.delete(nextOrderId);
    this.queue.delete(nextOrderId);

    return nextOrderId;
  }

  private getCreatedOrderMetadata(orderId: OrderId): CreatedOrderMetadata {
    assert(
      this.#createdOrdersMetadata.has(orderId),
      `Unexpected: missing created order data (orderId: ${orderId})`,
    );
    return this.#createdOrdersMetadata.get(orderId)!;
  }

  private postponeOrder(
    metadata: CreatedOrderMetadata,
    message: string,
    reason: PostponingReason,
    remainingDelay?: number,
  ) {
    const {
      attempts,
      context: { context, orderInfo },
    } = metadata;

    context.logger.info(message);
    this.executor.hookEngine.handleOrderPostponed({
      order: orderInfo,
      context,
      message,
      reason,
      attempts,
    });

    if (remainingDelay) {
      this.#mempoolService.addOrder(metadata.orderId, remainingDelay);
    } else if (metadata.context.orderInfo.status === OrderInfoStatus.ArchivalCreated) {
      this.#mempoolService.delayArchivalOrder(metadata.orderId, attempts);
    } else {
      this.#mempoolService.delayOrder(metadata.orderId, attempts);
    }
  }

  private rejectOrder(
    metadata: CreatedOrderMetadata,
    message: string,
    reason: RejectionReason,
  ): Promise<void> {
    const {
      attempts,
      context: { context, orderInfo },
    } = metadata;

    context.logger.info(message);
    this.executor.hookEngine.handleOrderRejected({
      order: orderInfo,
      context,
      message,
      reason,
      attempts,
    });

    return Promise.resolve();
  }

  private getFinalizationInfo(status: OrderInfoStatus, finalizationInfo: IncomingOrder<OrderInfoStatus.Created>['finalization_info']): 'Revoked' | 'Finalized' | number {
    if (status === OrderInfoStatus.ArchivalCreated) return 'Finalized';
    else if (finalizationInfo === 'Revoked') return 'Revoked';
    else if ('Finalized' in finalizationInfo) return 'Finalized'
    else if ('Confirmed' in finalizationInfo) return finalizationInfo.Confirmed.confirmation_blocks_count;
    else return 0
  }

  private async estimateOrder(estimator: OrderEstimator, metadata: CreatedOrderMetadata) {
    const estimation = await estimator.getEstimation();
    if (!estimation.isProfitable) {
      // print nice msg and return
      return this.postponeOrder(metadata, await estimation.explain(), PostponingReason.NOT_PROFITABLE);
    }



  }

  private async evaluateAndFulfill(metadata: CreatedOrderMetadata): Promise<void> {
    const { context: orderContext, orderInfo } = metadata.context;

    // special case for revokes: WS sends revokes as a part of Created event, and we want to handle it ASAP
    // probably, we need to move this special case to a higher level event handler (handleEvent) and convert it into ordinary event
    const finalizationInfo = this.getFinalizationInfo(orderInfo.status, (orderInfo as IncomingOrder<OrderInfoStatus.Created>).finalization_info);
    if (finalizationInfo === 'Revoked') {
      this.clearInternalQueues(orderInfo.orderId);

      const message = 'order has been revoked by the order feed due to chain reorganization';
      return this.rejectOrder(metadata, message, RejectionReason.REVOKED);
    }

    // here we start order evaluation
    const order = new CreatedOrder(orderInfo.orderId, orderInfo.order, orderInfo.status,
      finalizationInfo,
      {
        executor: this.executor,
        giveChain: orderContext.giveChain,
        takeChain: orderContext.takeChain,
        logger: orderContext.logger
      }
    );

    const verification = await order.verify();
    switch (verification.result) {
      case OrderValidationResult.Successful: {
        const v = <OrderValidation<OrderValidationResult.Successful>>(verification)
        return this.estimateOrder(v.estimator, metadata)
      }
      case OrderValidationResult.ShouldReject: {
        const v = <OrderValidation<OrderValidationResult.ShouldReject>>(verification)
        return this.rejectOrder(metadata, v.message, v.rejection)
      }
      case OrderValidationResult.ShouldPostpone: {
        const v = <OrderValidation<OrderValidationResult.ShouldPostpone>>(verification)
        return this.postponeOrder(metadata, v.message, v.postpone, v.delay)
      }
      default: {
        die (`Unexpected verification result: ${verification.result}`)
      }
    }


/*
    // building fulfill transaction
    const { transaction: fulfillTx } = await this.createOrderFullfillTx(
      order.getWithId(),
      reserveDstToken,
      requiredReserveDstAmount,
      BigInt(profitableTakeAmount),
      preswapTx,
      context,
      logger,
    );

    let txToSend: VersionedTransaction | InputTransaction;
    if (getEngineByChainId(orderInfo.order.take.chainId) === ChainEngine.EVM) {
      // remap properties
      txToSend = <InputTransaction>{
        data: (<EvmInstruction>fulfillTx).data,
        to: (<EvmInstruction>fulfillTx).to,
        value: (<EvmInstruction>fulfillTx).value.toString(),

        // we set cappedTxFee as (pre-gasPrice * pre-gasLimit) because pre-*s are the values the profitability has been
        // estimated against. Now, if gasLimit goes up BUT gasPrice goes down, we still comfortable executing a txn
        cappedFee: evmFulfillCappedGasPrice!.multipliedBy(evmFulfillGasLimit!),
      };

      try {
        txToSend.gasLimit = await (
          this.takeChain.fulfillProvider as EvmProviderAdapter
        ).estimateGas(txToSend);
        logger.debug(`final fulfill tx gas estimation: ${txToSend.gasLimit}`);
      } catch (e) {
        const message = `unable to estimate fullfil tx: ${e}`;
        logger.error(message);
        logger.error(e);
        return this.postponeOrder(
          metadata,
          message,
          PostponingReason.FULFILLMENT_EVM_TX_ESTIMATION_FAILED,
        );
      }
    } else {
      txToSend = <VersionedTransaction>fulfillTx;
    }
    logger.debug('fulfill transaction built');
    logger.debug(txToSend);

    try {
      const fulfillTxHash = await this.takeChain.fulfillProvider.sendTransaction(txToSend, {
        logger,
      });
      logger.info(`fulfill tx broadcasted, txhash: ${fulfillTxHash}`);

      // we add this order to the budget controller right before the txn is broadcasted
      // Mind that in case of an error (see the catch{} block below) we don't remove it from the
      // controller because the error may occur because the txn was stuck in the mempool and reside there
      // for a long period of time
      context.giveChain.throughput.addOrder(orderId, confirmationBlocksCount, usdWorth);

      this.executor.hookEngine.handleOrderFulfilled({
        order: orderInfo,
        txHash: fulfillTxHash,
      });
    } catch (e) {
      const message = `fulfill transaction failed: ${e}`;
      logger.error(message);
      logger.error(e);
      return this.postponeOrder(
        metadata,
        message,
        isRevertedError(e as Error)
          ? PostponingReason.FULFILLMENT_TX_REVERTED
          : PostponingReason.FULFILLMENT_TX_FAILED,
      );
    }

    // order is fulfilled, remove it from queues (the order may have come again thru WS)
    this.clearInternalQueues(orderInfo.orderId);
    context.giveChain.TVLBudgetController.flushCache();
    logger.info(`order fulfilled: ${orderId}`);

    // putting the order to the mempool, in case fulfill_txn gets lost
    const fulfillCheckDelay: number =
      this.takeChain.fulfillProvider.avgBlockSpeed *
      this.takeChain.fulfillProvider.finalizedBlockCount;
    this.#mempoolService.addOrder(metadata.orderId, fulfillCheckDelay);
*/
    return Promise.resolve();
  }
}