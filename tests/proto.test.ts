import { PmmEvent } from "../src/pmm_common";
import { readFileSync } from "fs";
import { U256ToBigint, U256ToBytesBE } from "../src/helpers";
import assert from "assert";

function protoTest() {
	const eventsRaw = readFileSync("./tests/protoEvents.raw");
	let events = eventsRaw
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
		const buf = U256ToBytesBE(u);
		const expected = Buffer.from([
			181, 113, 70, 178, 240, 6, 44, 91, 216, 99, 198, 253, 183, 75, 25, 113, 176, 254, 203, 38, 186, 203, 38, 37, 44, 125, 182, 76,
			61, 207, 18, 24,
		]);
		assert.equal(buf.toString("hex"), expected.toString("hex"));

		const expectedBN = 82068767258283445356179362784763446414958442405131196050130834764167948210712n;
		assert.equal(U256ToBigint(u), expectedBN);
	});

	it("can decode events", () => {
		for (const event of events) {
			const e = PmmEvent.fromBinary(event);
			if (e.event.oneofKind === "createdSrc") {
				console.log(e.event.createdSrc);
			}
		}
	});
}

describe("can decode protobuf", protoTest);
