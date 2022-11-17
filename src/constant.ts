import { helpers, WRAPPED_SOL_MINT } from "@debridge-finance/solana-utils";

export const evmNativeTokenAddress =
  "0x0000000000000000000000000000000000000000";
export const solanaNativeTokenAddress = helpers.bufferToHex(
  WRAPPED_SOL_MINT.toBuffer()
);
