import { OrderData } from "@debridge-finance/pmm-client/src/order";
import { helpers } from "@debridge-finance/solana-utils";

import { ExecutorConfig } from "../config";

import { ValidatorContext } from "./order.validator";
import { ChainId } from "@debridge-finance/pmm-client";
import { convertAddressToBuffer } from "../utils/convert.address.to.buffer";
import { buffersAreEqual } from "../utils/buffers.are.equal";
import { OrderValidatorInterface } from "./order.validator.interface";

/**
 * Checks if the order's locked token is not in the blacklist. This validator is useful to filter off orders that hold undesired and/or illiquid tokens.
 *
 * */
export class BlackListedGiveToken extends OrderValidatorInterface {

  private addressesBuffer: Uint8Array[];

  constructor(private readonly addresses: string[]) {
    super();
  }

  init(chainId: ChainId): Promise<void> {
    super.chainId = chainId;
    this.addressesBuffer = this.addresses.map((address) => convertAddressToBuffer(chainId, address));
    return Promise.resolve();
  }

  validate(order: OrderData, config: ExecutorConfig, context: ValidatorContext): Promise<boolean> {
    const logger = context.logger.child({ validator: "blackListedGiveToken" });
    const result = this.addressesBuffer.some(address => buffersAreEqual(order.give.tokenAddress, address))

    const giveToken = !helpers.bufferToHex(Buffer.from(order.give.tokenAddress));
    logger.info(`approve status: ${result}, giveToken ${giveToken}`);
    return Promise.resolve(result);
  }
}

export function blacklistedGiveToken(addresses: string[]) {
  return new BlackListedGiveToken(addresses)
}