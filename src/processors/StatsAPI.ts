import axios from "axios";

type MultiFormatRepresentation = {
  Base64Value: string;
  bytesArrayValue: string;
  stringValue: string;
}

type GetForUnlockAuthoritiesResponse = {
  orders: Array<{
    orderId: MultiFormatRepresentation,
    giveTokenAddress: MultiFormatRepresentation,
    finalGiveAmount: MultiFormatRepresentation
  }>,
  totalCount: number
}

type OrderLiteModelResponse = {
  orderId: MultiFormatRepresentation;
  state: string;
  makerOrderNonce: number;
  makerSrc: MultiFormatRepresentation;
  giveOffer: {
    chainId: MultiFormatRepresentation;
    tokenAddress: MultiFormatRepresentation;
    amount: MultiFormatRepresentation;
  }
  receiverDst: MultiFormatRepresentation;
  takeOffer: {
    chainId: MultiFormatRepresentation;
    tokenAddress: MultiFormatRepresentation;
    amount: MultiFormatRepresentation;
  }
  givePatchAuthoritySrc: MultiFormatRepresentation;
  orderAuthorityAddressDst: MultiFormatRepresentation;
  allowedTakerDst: Partial<MultiFormatRepresentation>,
  allowedCancelBeneficiarySrc: Partial<MultiFormatRepresentation>
}

export class StatsAPI {
  private static readonly defaultHost = 'https://dln-api.debridge.finance';

  constructor(private readonly host = StatsAPI.defaultHost) {}

  async getOrderLiteModel(orderId: string): Promise<OrderLiteModelResponse> {
    const resp = await axios.get(`${this.host  }/api/Orders/${  orderId  }/liteModel`)
    return resp.data
  }

  async getForUnlockAuthorities(giveChainIds: number[], orderStates: string[], unlockAuthorities: string[], skip: number, take: number): Promise<GetForUnlockAuthoritiesResponse> {
    const resp = await axios.post(`${this.host  }/api/Orders/getForUnlockAuthorities`, {
      giveChainIds,
      orderStates,
      unlockAuthorities: unlockAuthorities.join(' '),
      take,
      skip,
    })
    return resp.data
  }
}