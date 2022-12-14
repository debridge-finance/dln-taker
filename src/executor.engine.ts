import { helpers } from "@debridge-finance/solana-utils";
import { config } from "dotenv";
import pino from "pino";

import { ExecutorLaunchConfig } from "./config";
import { Executor } from "./executor";

config();

export class ExecutorEngine {
  private executors: Executor[];
  private orderFulfilledMap = new Map<string, boolean>();

  constructor(private executorConfigs: ExecutorLaunchConfig[]) {
  }

  async init() {
    const logger = pino({
      level: process.env.LOG_LEVEL || "info",
    });
    this.executors = await Promise.all(
      this.executorConfigs.map(async (config) => {
        const executor = new Executor(logger, this.orderFulfilledMap)
        await executor.init(config)
        return executor
      })
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
