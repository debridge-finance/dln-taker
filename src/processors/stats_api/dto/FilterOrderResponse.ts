export class FilterOrderResponse {
  orders: Order[];
  totalCount: number;
}

export class Order {
  orderId: string;
  creationTimestamp: number;
  giveOfferWithMetadata: OfferWithMetadata;
  takeOfferWithMetadata: OfferWithMetadata;
  state: string;
  finalPercentFee: Fee;
  fixFee: Fee;
  unlockAuthorityDst: string;
  createEventTransactionHash: string;
}

class OfferWithMetadata {
  chainId: ChainId;
  tokenAddress: TokenAddress;
  amount: Amount;
  finalAmount: Amount;
  metadata: Metadata;
  decimals: number;
  name: string;
  symbol: string;
  logoURI: string;
}

class ChainId {
  Base64Value: string;
  bytesArrayValue: number[];
  bigIntegerValue: number;
  stringValue: string;
}

class TokenAddress {
  Base64Value: string;
  bytesArrayValue: string;
  stringValue: string;
}

class Amount {
  Base64Value: string;
  bytesArrayValue: number[];
  bigIntegerValue: number;
  stringValue: string;
}

class Metadata {
  decimals: number;
  name: string;
  symbol: string;
}

class Fee {
  Base64Value: string;
  bytesArrayValue: number[];
  bigIntegerValue: number;
  stringValue: string;
}
