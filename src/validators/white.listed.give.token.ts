import { ChainId, OrderData } from "@debridge-finance/dln-client";
import { ExecutorConfig } from "../config";
import { ValidatorContext } from "./order.validator";
import { OrderValidatorInterface } from "./order.validator.interface";
import { convertAddressToBuffer } from "../utils/convert.address.to.buffer";
import { buffersAreEqual } from "../utils/buffers.are.equal";
import { convertBufferToAddress } from "../utils/convert.buffer.to.address";

/**
 * Checks if the address who placed the order on the source chain is in the whitelist. This validator is useful to filter out orders placed by the trusted parties.
 */
export class WhiteListedGiveToken extends OrderValidatorInterface {

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
    const logger = context.logger.child({ validator: "WhiteListedGiveToken" });
    const result = this.addressesBuffer.some(address => buffersAreEqual(order.give.tokenAddress, address))

    const giveToken = convertBufferToAddress(this.chainId, order.give.tokenAddress);
    logger.info(`approve status: ${result}, giveToken ${giveToken}`);
    return Promise.resolve(result);
  }
}

export function whitelistedGiveToken(addresses: string[]) {
  return new WhiteListedGiveToken(addresses)
}
