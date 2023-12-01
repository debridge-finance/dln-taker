import {
  CommonDlnClient,
  Evm,
  Solana,
  Logger as ClientLogger,
  LogLevel,
} from '@debridge-finance/dln-client';
import { Logger } from 'pino';

export const createClientLogger = (logger: Logger) =>
  new ClientLogger((level: LogLevel, args) => {
    // concat args so they appear as a first string in pino
    const message = args
      .reduce<string>((result, currentValue) => {
        let currentString = currentValue;
        if (typeof currentValue === 'object') {
          currentString = JSON.stringify(currentValue);
        }
        return `${result} ${currentString}`;
      }, '')
      .trim();
    switch (level) {
      case LogLevel.LOG:
      case LogLevel.VERBOSE: {
        logger.debug(`[dln-ts-client] ${message}`);
        break;
      }

      case LogLevel.ERROR:
      default: {
        logger.error(`[dln-ts-client] ${message}`);
        break;
      }
    }
  });

type ActiveClients = Solana.DlnClient | Evm.DlnClient;
export type DlnClient = CommonDlnClient<ActiveClients>;
