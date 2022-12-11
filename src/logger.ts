import {Logger as ClientLogger, LogLevel} from "@debridge-finance/dln-client";
import {Logger} from "pino";

export const createClientLogger = (logger: Logger) => {
  return new ClientLogger((level: LogLevel, ...args) => {
    args = args[0];
    const message = JSON.stringify(args);
    switch (level) {
      case LogLevel.LOG: {
        logger.info(message);
        break;
      }

      case LogLevel.VERBOSE: {
        logger.debug(message);
        break;
      }

      case LogLevel.ERROR:
      default: {
        logger.error(message);
        break;
      }
    }
  });
};
