export enum MarketMakerExecutorErrorType {
  OrderIsFulfilled = "OrderIsFulfilled",
}

export class MarketMakerExecutorError extends Error {
  constructor(
    private readonly type: MarketMakerExecutorErrorType,
    message: string = ""
  ) {
    super(message || type);
  }
}
