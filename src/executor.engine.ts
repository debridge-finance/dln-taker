import { helpers } from "@debridge-finance/solana-utils";
import { config } from "dotenv";
import pino from "pino";

import { ExecutorConfig } from "./config";
import { Executor } from "./executor";

config();

export class ExecutorEngine {
  private readonly executors: Executor[];

  constructor(executorConfigs: ExecutorConfig[]) {
    const logger = pino({
      level: process.env.LOG_LEVEL || "info",
    });
    const orderFulfilledMap = new Map<string, boolean>();
    this.executors = executorConfigs.map((config) => {
      return new Executor(config, orderFulfilledMap, logger);
    });
  }

  async init() {
    return Promise.all(
      this.executors.map(async (executor) => executor.init())
    );
  }

  async start() {
    while (true) {
      await Promise.all(
        this.executors.map(async (executor) => {
          return executor.execute();
        })
      );
      await helpers.sleep(1 * 1000); // todo
    }
  }
}
