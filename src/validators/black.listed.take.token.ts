import {buffersAreEqual, ChainId, OrderData, tokenStringToBuffer} from "@debridge-finance/dln-client";

import { helpers } from "@debridge-finance/solana-utils";

import { ExecutorConfig } from "../config";

import { ValidatorContext } from "./order.validator";
import { OrderValidatorInterface } from "./order.validator.interface";

/**
 * Checks if the order's requested token is not in the blacklist. This validator is useful to filter off orders that requested undesired and/or illiquid tokens. *
 *
 * */
export class BlackListedTakeToken extends OrderValidatorInterface {

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
    const logger = context.logger.child({ validator: "blackListedTakeToken" });
    const result = !this.addressesBuffer.some(address => buffersAreEqual(order.take.tokenAddress, address));

    const takeToken = helpers.bufferToHex(Buffer.from(order.take.tokenAddress));
    logger.info(`approve status: ${result}, takeToken ${takeToken}`);
    return Promise.resolve(result);
  }
}

export function blacklistedTakeToken(addresses: string[]) {
  return new BlackListedTakeToken(addresses)
}
