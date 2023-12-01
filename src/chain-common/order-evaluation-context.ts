import { SwapConnectorResult } from '@debridge-finance/dln-client';
import { assert } from '../errors';

export type OrderEvaluationPayload = {
  preFulfillSwap?: SwapConnectorResult;
  validationPreFulfillSwap?: SwapConnectorResult;
} & {
  [key in string]: any;
};

export abstract class OrderEvaluationContextual {
  readonly #payload: OrderEvaluationPayload = {};

  constructor(base?: OrderEvaluationPayload) {
    if (base) this.#payload = base;
  }

  protected setPayloadEntry<K extends keyof OrderEvaluationPayload>(
    key: K,
    value: OrderEvaluationPayload[K],
  ) {
    assert(this.#payload[key] === undefined, `accidentally overwriting the ${key} payload entry`);
    this.#payload[key] = value;
  }

  protected getPayloadEntry<T>(key: string): T {
    assert(typeof this.#payload[key] !== undefined, `payload does not contain entry "${key}"`);

    return this.#payload[key];
  }

  protected get payload() {
    return this.#payload;
  }
}
