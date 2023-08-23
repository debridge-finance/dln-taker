import { ChainId } from '@debridge-finance/dln-client';
import configurator from './configurator/index';
import * as processors from './processors';
import * as filters from './filters';
import { ExecutorLaunchConfig } from './config';
import * as environments from './environments';
import { setCurrentEnvironment } from './environments';
import { WsNextOrder as TempWsNextOrder } from './orderFeeds/ws.order.feed';

/**
 * Mark this export as deprecated intentionally: this won't be exported in ExecutorLaunchConfig v3
 * @deprecated
 */
const CURRENT_ENVIRONMENT = environments.PRODUCTION;

/**
 * Mark this export as deprecated intentionally: this won't be exported in ExecutorLaunchConfig v3
 * @deprecated
 */
const WsNextOrder = TempWsNextOrder;

export {
  ChainId,
  configurator,
  processors,
  filters,
  ExecutorLaunchConfig,
  environments,
  setCurrentEnvironment,

  // The following exports are required to support legacy ExecutorLaunchConfig v2
  CURRENT_ENVIRONMENT,
  WsNextOrder,
};
