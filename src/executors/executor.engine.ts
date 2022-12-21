import { config } from "dotenv";
import pino, { Logger } from "pino";

import { ExecutorLaunchConfig } from "../config";

import { Executor } from "./executor";

config();

export class ExecutorEngine {
  private logger: Logger;
  private executor: Executor;

  constructor(private readonly executorConfig: ExecutorLaunchConfig) {
    this.logger = pino({
      level: process.env.LOG_LEVEL || "info",
    });
    this.executor = new Executor(this.logger);
  }

  async init() {
    return this.executor.init(this.executorConfig);
  }
}
