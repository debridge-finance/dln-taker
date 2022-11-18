import { ExecutorEngine } from "./executor.engine";
import {config} from "dotenv";

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

config();

async function main() {
  let configPath = process.argv[2];
  if (!configPath.startsWith('/')) {
    configPath = process.cwd() + '/' + configPath;
  }
  console.log(`config path ${configPath}`);
  const config = await import(configPath);
  const configs = [config];

  const executor = new ExecutorEngine(configs);
  await executor.init();
  await executor.start();
}

main()
  .catch(e => console.error("Executor failed:", (e as Error).message))
