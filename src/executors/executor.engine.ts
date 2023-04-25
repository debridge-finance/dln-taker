import { config } from "dotenv";
import pino, { Logger } from "pino";
import pretty from "pino-pretty";
import { createWriteStream } from "pino-sentry";

import { ExecutorLaunchConfig } from "../config";

import { Executor } from "./executor";
import { SlippageOverrideService } from "../services/SlippageOverrideService";
import { baseConstraints } from "../defaults/baseConstraints";

config();

export class ExecutorEngine {
  private logger: Logger;
  private executor: Executor;

  constructor(private readonly executorConfig: ExecutorLaunchConfig) {
    this.createLogger();
    this.executor = new Executor(this.logger);
  }

  async init() {
    this.executor.setSlippageOverloader(this.createSlippageOverrideService());
    return this.executor.init(this.executorConfig);
  }

  createSlippageOverrideService(): SlippageOverrideService {
    const localConfig = {
      slippageBps: this.executorConfig.constraints?.defaultPreFulfillSwapSlippageBpsBuffer,
      perChain: this.executorConfig.chains?.reduce((res, chain) => {
        res[chain.chain] = {
          slippageBps: chain.constraints?.defaultPreFulfillSwapSlippageBpsBuffer,
          perTokenIn: chain.constraints?.preFulfillSwapSlippageOverrides,
        };
        return res;
      }, {} as any)
    };
    let baseConfig = {};
    if (baseConstraints.preFulfillSwapSlippageBuffer) {
      baseConfig = {
        slippageBps: baseConstraints.preFulfillSwapSlippageBuffer.slippageBps,
        perChain: baseConstraints.preFulfillSwapSlippageBuffer.perChain,
      };
    }
    return new SlippageOverrideService(localConfig, baseConfig);
  }

  private createLogger() {
    const prettyStream = pretty({
      colorize: process.stdout.isTTY,
      sync: true,
      singleLine: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss.l',
    });
    const streams: any[] = [
      {
        level: "debug",
        stream: prettyStream,
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
        translateFormat: 'd mmm yyyy H:MM'
      },
      pino.multistream(streams, {}),
    );
  }
}
