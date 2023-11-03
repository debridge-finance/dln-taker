import { ChainId } from '@debridge-finance/dln-client';
import { Authority } from '../interfaces';
import { ITransactionBuilder, TransactionSender } from './tx-builder';

export class EmptyTransactionBuilder implements ITransactionBuilder {
  constructor(private chain: ChainId) {}

  // eslint-disable-next-line class-methods-use-this -- Allowed because this class is a dummy implementation of an iface
  get fulfillAuthority(): Authority {
    // TODO: unfortunately, we can't throw an error from here because Executor accesses this property
    // for ExecutorSupportedChain.fulfillAuthority propagation. In the future, we'll make ExecutorSupportedChain
    // a full-featured class where we can reassign it, but right now it is easier to return a dummy value
    // throw new Error(`Accessing the fulfill authority of ${ChainId[this.chain]} which is disabled`);
    return <any>{};
  }

  getOrderFulfillTxSender(): TransactionSender {
    throw new Error(`Accessing the fulfill authority of ${ChainId[this.chain]} which is disabled`);
  }

  // eslint-disable-next-line class-methods-use-this -- Allowed because this class is a dummy implementation of an iface
  get unlockAuthority(): Authority {
    // TODO: unfortunately, we can't throw an error from here because Executor accesses this property
    // for ExecutorSupportedChain.unlockAuthority propagation. In the future, we'll make ExecutorSupportedChain
    // a full-featured class where we can reassign it, but right now it is easier to return a dummy value
    // throw new Error(`Accessing the unlock authority of ${ChainId[this.chain]} which is disabled`);
    return <any>{};
  }

  getBatchOrderUnlockTxSender(): TransactionSender {
    throw new Error(`Accessing the unlock authority of ${ChainId[this.chain]} which is disabled`);
  }

  // eslint-disable-next-line class-methods-use-this -- Allowed because this class is a dummy implementation of an iface
  getInitTxSenders(): Promise<TransactionSender[]> {
    return Promise.resolve([]);
  }
}
