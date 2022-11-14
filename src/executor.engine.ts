import {ExecutorConfig} from "./config";
import {Executor} from "./executor";
import {helpers} from "@debridge-finance/solana-utils";

export class ExecutorEngine {
  private readonly executors: Executor[];

  constructor(executorConfigs: ExecutorConfig[]) {
    const orderFulfilledMap = new Map<string, boolean>();
    this.executors = executorConfigs.map(config => {
      return new Executor(config, orderFulfilledMap);
    });
  }

  async start() {
    await Promise.all(this.executors.map(async executor => {
      await executor.init();
      return executor.execute();
    }));
    await helpers.sleep(2 * 1000);//todo
  }
}
