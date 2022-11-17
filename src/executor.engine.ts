import {ExecutorConfig} from "./config";
import {Executor} from "./executor";
import {helpers} from "@debridge-finance/solana-utils";
import pino from "pino";
import { config } from "dotenv";

config();

export class ExecutorEngine {
  private readonly executors: Executor[];

  constructor(executorConfigs: ExecutorConfig[]) {
    const logger = pino({
      level: process.env.LOG_LEVEL || 'info'
    });
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
