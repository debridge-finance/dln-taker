import { SwapConnectorResult } from '@debridge-finance/dln-client';
import { assert } from 'src/errors';

export type OrderEvaluationPayload = { estimation?: SwapConnectorResult } & {
  [key in string]: any;
};

export abstract class OrderEvaluationContextual {
  readonly #payload: OrderEvaluationPayload = {};

  constructor(base?: OrderEvaluationPayload) {
    if (base) this.#payload = base;
  }

  protected setPayloadEntry<T>(key: string, value: T) {
    assert(
      this.#payload[key] === undefined,
      `OrderValidator: accidentally overwriting the ${key} payload entry`,
    );
    this.#payload[key] = value;
  }

  protected getPayloadEntry<T>(key: string): T {
    assert(typeof this.#payload[key] !== undefined, `payload does not contain ${key}`);

    return this.#payload[key];
  }

  protected get payload() {
    return this.#payload;
  }
}
