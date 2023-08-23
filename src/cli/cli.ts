import BigNumber from 'bignumber.js';
import { config } from 'dotenv';
import path from 'path';

import { ExecutorEngine } from '../executors/executor.engine';

// this is needed to serialize objects with a bigint inside
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

// Almost never return exponential notation:
BigNumber.config({ EXPONENTIAL_AT: 1e9 });

config();

async function main() {
  let userConfigPath = process.argv[2];

  if (userConfigPath === undefined) {
    userConfigPath = path.join(process.cwd(), 'executor.config.ts');
  }

  if (!path.isAbsolute(userConfigPath)) {
    userConfigPath = path.join(process.cwd(), userConfigPath);
    userConfigPath = path.normalize(userConfigPath);
  }

  try {
    require.resolve('typescript');
  } catch {
    throw new Error('Typescript not installed');
  }

  try {
    require.resolve('ts-node');
  } catch {
    throw new Error('ts-node not installed');
  }

  const tsNodeInstance = (process as any)[Symbol.for('ts-node.register.instance')];
  if (!tsNodeInstance) {
    // eslint-disable-next-line no-console -- Intentional usage in the entry point on dev machine
    console.debug('Loading custom ts-node/register');
    const tsNodeRegisterModule = 'ts-node/register';
    // eslint-disable-next-line global-require, import/no-dynamic-require -- Intentional usage in the entry point on dev machine
    require(tsNodeRegisterModule);
  }

  // eslint-disable-next-line no-console -- Intentional usage in the entry point
  console.log(`Using config file: ${userConfigPath}`);

  // eslint-disable-next-line global-require, import/no-dynamic-require -- Intentional usage to load user config
  const importedConfig = require(userConfigPath);
  const userConfig = importedConfig.default !== undefined ? importedConfig.default : importedConfig;

  const executor = new ExecutorEngine(userConfig);
  await executor.init();
}

main().catch((e) => {
  // eslint-disable-next-line no-console -- Intentional usage in the entry point
  console.error(`Launching executor failed`);
  // eslint-disable-next-line no-console -- Intentional usage in the entry point
  console.error(e);
  process.exit(1);
});
