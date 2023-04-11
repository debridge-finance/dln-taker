import BigNumber from "bignumber.js";
import { config } from "dotenv";
import path from "path";

import { ExecutorEngine } from "./executors/executor.engine";

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

// Almost never return exponential notation:
BigNumber.config({ EXPONENTIAL_AT: 1e+9 })

config();

async function main() {
  let configPath = process.argv[2];

  if (configPath === undefined) {
    configPath = path.resolve(__dirname, "..", "executor.config.ts");
  }

  if (!configPath.startsWith("/")) {
    configPath = process.cwd() + "/" + configPath;
  }

  console.log(`Using config file: ${configPath}`);
  const config = await import(configPath);

  const executor = new ExecutorEngine(config);
  await executor.init();
}

main().catch((e) => {
  console.error(`Launching executor failed`);
  console.error(e)
  process.exit(1);
});
