import { helpers } from "@debridge-finance/solana-utils";
import assert from "assert";
import "mocha";

import {  U256 } from "../src/helpers";

function testConversion() {
  it("can convert hex to bigint", () => {
    const buf = helpers.hexToBuffer(
      "0x0000000000000000000000000000000000000000000000000000000000736f6c"
    );
    assert.equal(BigInt(7565164), U256.fromBytesBE(buf).toBigInt());
    const buf2 = helpers.hexToBuffer(
      "0x0000000000000000000000000000000000000000000000000000000000000064"
    );
    assert.equal(BigInt(100), U256.fromBytesBE(buf2).toBigInt());
  });
}

describe("Can convert between various formats", testConversion);
