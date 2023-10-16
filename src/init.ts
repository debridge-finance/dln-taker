import BigNumber from 'bignumber.js';

// this is needed to serialize objects with a bigint inside
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

// Almost never return exponential notation:
BigNumber.config({ EXPONENTIAL_AT: 1e9 });
