import { config } from "dotenv";
import pino, { Logger } from "pino";
import pretty from "pino-pretty";
import { createWriteStream } from "pino-sentry";

import { ExecutorLaunchConfig } from "../config";

import { Executor } from "./executor";

config();

export class ExecutorEngine {
  private logger: Logger;
  private executor: Executor;

  constructor(private readonly executorConfig: ExecutorLaunchConfig) {
    this.createLogger();
    this.executor = new Executor(this.logger);
  }

  async init() {
    return this.executor.init(this.executorConfig);
  }

  private createLogger() {
    const prettyStram = pretty({
      colorize: true,
      sync: true,
      singleLine: true,
    });
    const streams: any[] = [
      {
        level: "debug",
        stream: prettyStram,
      },
    ];
    if (process.env.SENTRY_DSN) {
      const sentryStream = createWriteStream({
        dsn: process.env.SENTRY_DSN,
      });
      streams.push({ level: "error", stream: sentryStream });
    }
    this.logger = pino(
      {
        level: process.env.LOG_LEVEL || "info",
      },
      pino.multistream(streams)
    );
  }
}
