import {ExecutorConfig} from "./config";
import {Executor} from "./executor";
import {helpers} from "@debridge-finance/solana-utils";
import {Logger} from "pino";

export class ExecutorEngine {
  private readonly executors: Executor[];

  constructor(executorConfigs: ExecutorConfig[], private readonly logger: Logger) {
    const orderFulfilledMap = new Map<string, boolean>();
    this.executors = executorConfigs.map(config => {
      return new Executor(config, orderFulfilledMap, logger);
    });
  }

  async start() {
    while (true) {
      await Promise.all(this.executors.map(async executor => {
        await executor.init();
        return executor.execute();
      }));
      await helpers.sleep(2 * 1000);//todo
    }
  }
}
