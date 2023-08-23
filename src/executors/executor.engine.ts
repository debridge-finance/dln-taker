import { config } from 'dotenv';
import pino, { Logger } from 'pino';
import pretty from 'pino-pretty';
import { createWriteStream } from 'pino-sentry';

import { ExecutorLaunchConfig } from '../config';

import { Executor } from './executor';

config();

export class ExecutorEngine {
  private logger: Logger;

  private executor: Executor;

  constructor(private readonly executorConfig: ExecutorLaunchConfig) {
    this.logger = ExecutorEngine.createLogger();
    this.executor = new Executor(this.logger);
  }

  async init() {
    return this.executor.init(this.executorConfig);
  }

  private static createLogger() {
    const prettyStream = pretty({
      colorize: process.stdout.isTTY,
      sync: true,
      singleLine: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss.l',
    });
    const streams: any[] = [
      {
        level: 'debug',
        stream: prettyStream,
      },
    ];
    if (process.env.SENTRY_DSN) {
      const sentryStream = createWriteStream({
        dsn: process.env.SENTRY_DSN,
      });
      streams.push({ level: 'error', stream: sentryStream });
    }
    return pino(
      {
        level: process.env.LOG_LEVEL || 'info',
        translateFormat: 'd mmm yyyy H:MM',
      },
      pino.multistream(streams, {}),
    );
  }
}
