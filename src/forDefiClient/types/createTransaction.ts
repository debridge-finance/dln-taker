export type SignedCreateTransactionRequest = {
  requestBody: string;
  timestamp: string;
  signature: string;
};

export type CreateTransactionResponse = {
  id: string;
};
