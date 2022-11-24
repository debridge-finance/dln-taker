import { ChainId, OrderData } from "@debridge-finance/dln-client";
import { ExecutorConfig } from "../config";
import { ValidatorContext } from "./order.validator";
import { OrderValidatorInterface } from "./order.validator.interface";
import { convertAddressToBuffer } from "../utils/convert.address.to.buffer";
import { buffersAreEqual } from "../utils/buffers.are.equal";
import {convertBufferToAddress} from "../utils/convert.buffer.to.address";

/**
 * Checks if the order's requested token is in the whitelist. This validator is useful to target orders that request specific tokens.
 * */
export class WhiteListedTakeToken extends OrderValidatorInterface {

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
    const logger = context.logger.child({ validator: "WhiteListedTakeToken" });
    const result = this.addressesBuffer.some(address => buffersAreEqual(order.take.tokenAddress, address))

    const takeToken = convertBufferToAddress(this.chainId, order.take.tokenAddress);
    logger.info(`approve status: ${result}, takeToken ${takeToken}`);
    return Promise.resolve(result);
  }
}

export function whitelistedTakeToken(addresses: string[]) {
  return new WhiteListedTakeToken(addresses)
}
