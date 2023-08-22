import { Order as PmmOrder } from "@debridge-finance/dln-client";
import assert from "assert";
import { readFileSync } from "fs";

import { eventToOrderData, U256 } from "../src/helpers";
import { PmmEvent } from "../src/pmm_common";

function protoTest() {
  const eventsRaw = readFileSync("./tests/protoEvents.raw");
  const events = eventsRaw
    .toString()
    .split("\n")
    .map((s) => Uint8Array.from(Buffer.from(s, "hex")));

  it("can convert u256", () => {
    const u = {
      limb1: 3205918948328411672n,
      limb2: 12753854561962894885n,
      limb3: 15592525127890966897n,
      limb4: 13074308927578319963n,
    };
    const buf = new U256(u);
    const expected = Buffer.from([
      181, 113, 70, 178, 240, 6, 44, 91, 216, 99, 198, 253, 183, 75, 25, 113,
      176, 254, 203, 38, 186, 203, 38, 37, 44, 125, 182, 76, 61, 207, 18, 24,
    ]);
    assert.equal(buf.toBytesBE().toString("hex"), expected.toString("hex"));

    const expectedBN =
      82068767258283445356179362784763446414958442405131196050130834764167948210712n;
    assert.equal(new U256(u).toBigInt(), expectedBN);
  });

  xit("can decode events", () => {
    for (const event of events) {
      const e = PmmEvent.fromBinary(event);
      if (e.event.oneofKind === "createdSrc") {
        console.log(e.event.createdSrc);
      }
    }
  });

  xit("can decode json", () => {
    const j = {
      createdSrc: {
        referralCode: 4294967295,
        transactionMetadata: {
          transactionHash: [
            51, 212, 23, 3, 161, 122, 101, 109, 172, 212, 241, 105, 189, 58,
            165, 90, 139, 181, 22, 2, 86, 70, 79, 194, 159, 254, 105, 244, 59,
            24, 185, 153, 144, 78, 181, 1, 80, 228, 165, 207, 208, 216, 96, 178,
            139, 60, 52, 254, 158, 106, 196, 105, 84, 192, 10, 138, 191, 88, 71,
            208, 99, 153, 51, 2,
          ],
          blockHash: [
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 9, 191, 39, 40,
          ],
          blockTime: "1663751187",
          blockNumber: "163522344",
          trackedByReaderTimestamp: "1663751202",
          initiator: {
            address: [
              214, 162, 161, 41, 59, 101, 45, 80, 13, 56, 8, 19, 136, 105, 13,
              34, 68, 58, 60, 120, 170, 223, 195, 208, 236, 99, 144, 143, 208,
              81, 52, 2,
            ],
          },
        },
        giveTokenMetadata: {
          tokenAddress: [
            6, 155, 136, 87, 254, 171, 129, 132, 251, 104, 127, 99, 70, 24, 192,
            53, 218, 196, 57, 220, 26, 235, 59, 85, 152, 160, 240, 0, 0, 0, 0,
            1,
          ],
          name: "",
          symbol: "",
          decimals: 9,
          chainId: { limb1: "7565164", limb2: "0", limb3: "0", limb4: "0" },
        },
        createdOrder: {
          makerOrderNonce: "0",
          give: {
            chainId: { limb1: "7565164", limb2: "0", limb3: "0", limb4: "0" },
            tokenAddress: {
              address: [
                6, 155, 136, 87, 254, 171, 129, 132, 251, 104, 127, 99, 70, 24,
                192, 53, 218, 196, 57, 220, 26, 235, 59, 85, 152, 160, 240, 0,
                0, 0, 0, 1,
              ],
            },
            amount: { limb1: "900", limb2: "0", limb3: "0", limb4: "0" },
          },
          take: {
            chainId: { limb1: "1", limb2: "0", limb3: "0", limb4: "0" },
            tokenAddress: {
              address: [
                160, 184, 105, 145, 198, 33, 139, 54, 193, 209, 157, 74, 46,
                158, 176, 206, 54, 6, 235, 72,
              ],
            },
            amount: { limb1: "1000", limb2: "0", limb3: "0", limb4: "0" },
          },
          makerSrc: {
            address: [
              214, 162, 161, 41, 59, 101, 45, 80, 13, 56, 8, 19, 136, 105, 13,
              34, 68, 58, 60, 120, 170, 223, 195, 208, 236, 99, 144, 143, 208,
              81, 52, 2,
            ],
          },
          receiverDst: {
            address: [
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            ],
          },
          givePatchAuthoritySrc: {
            address: [
              1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            ],
          },
          orderAuthorityAddressDst: {
            address: [
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            ],
          },
          allowedTakerDst: {
            address: {
              type: "Buffer",
              data: [
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              ],
            },
          },
          allowedCancelBeneficiarySrc: {
            address: [
              2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            ],
          },
        },
        orderId: {
          limb1: "7612552972477721004",
          limb2: "2629485296425343480",
          limb3: "890162675885137285",
          limb4: "7699254802479744796",
        },
        fixFee: { limb1: "1", limb2: "0", limb3: "0", limb4: "0" },
        percentFee: { limb1: "100", limb2: "0", limb3: "0", limb4: "0" },
      },
    };
    const pmmCreated = PmmEvent.fromJson(j);
    if (pmmCreated.event.oneofKind === "createdSrc") {
      const orderData = eventToOrderData(
        pmmCreated.event.createdSrc.createdOrder!
      );
      console.log(PmmOrder.calculateId(orderData));
      console.log(pmmCreated.event.createdSrc.orderId!);
    }
  });
}

describe("can decode protobuf", protoTest);
