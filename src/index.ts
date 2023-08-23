import BigNumber from "bignumber.js";
import { config } from "dotenv";
import path from "path";

import { ExecutorEngine } from "./executors/executor.engine";

// Almost never return exponential notation:
BigNumber.config({ EXPONENTIAL_AT: 1e+9 })

config();

async function main() {
  let userConfigPath = process.argv[2];

  if (userConfigPath === undefined) {
    userConfigPath = path.resolve(__dirname, "..", "executor.config.ts");
  }

  if (!userConfigPath.startsWith("/")) {
    userConfigPath = `${process.cwd()  }/${  userConfigPath}`;
  }

  // eslint-disable-next-line no-console -- Intentional usage in the entry point
  console.log(`Using config file: ${userConfigPath}`);

  // eslint-disable-next-line global-require, import/no-dynamic-require -- Intentional usage to load user config
  const userConfig = require(userConfigPath)

  const executor = new ExecutorEngine(userConfig);
  await executor.init();
}

main().catch((e) => {
  // eslint-disable-next-line no-console -- Intentional usage in the entry point
  console.error(`Launching executor failed`);
  // eslint-disable-next-line no-console -- Intentional usage in the entry point
  console.error(e)
  process.exit(1);
});
