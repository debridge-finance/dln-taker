import {buffersAreEqual, ChainId, OrderData, tokenStringToBuffer} from "@debridge-finance/dln-client";

import { helpers } from "@debridge-finance/solana-utils";

import { ExecutorConfig } from "../config";

import { ValidatorContext } from "./order.validator";
import { OrderValidatorInterface } from "./order.validator.interface";

/**
 * Checks if the receiver address (who will take funds upon successful order fulfillment) is in the whitelist.
 * This validator is useful to filter out orders placed by the trusted parties.
 */
class WhitelistedReceiver extends OrderValidatorInterface {

  private addressesBuffer: Uint8Array[];

  constructor(private readonly addresses: string[]) {
    super();
  }

  init(chainId: ChainId): Promise<void> {
    super.chainId = chainId;
    this.addressesBuffer = this.addresses.map((address) => tokenStringToBuffer(chainId, address));
    return Promise.resolve();
  }

  validate(order: OrderData, config: ExecutorConfig, context: ValidatorContext): Promise<boolean> {
    const logger = context.logger.child({ validator: "WhiteListedReceiver" });
    const result = this.addressesBuffer.some(address => buffersAreEqual(order.receiver, address));

    const receiver = helpers.bufferToHex(Buffer.from(order.receiver));
    logger.info(`approve status: ${result}, receiver ${receiver}`);
    return Promise.resolve(result);
  }
}

export function whitelistedReceiver(addresses: string[]): OrderValidatorInterface {
  return new WhitelistedReceiver(addresses)
}
