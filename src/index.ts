import { ChainId } from '@debridge-finance/dln-client';
import configurator from './configurator/index';
import * as filters from './filters';
import { ExecutorLaunchConfig } from './config';
import * as environments from './environments';
import { setCurrentEnvironment } from './environments';
import { WsNextOrder as TempWsNextOrder } from './orderFeeds/ws.order.feed';
import { Hooks } from './hooks/HookEnums';
/**
 * Will get rid of this when developing ExecutorLaunchConfigV3 #862kawyur
 */
const CURRENT_ENVIRONMENT = environments.PRODUCTION;

/**
 * Will get rid of this when developing ExecutorLaunchConfigV3 #862kawyur
 */
const WsNextOrder = TempWsNextOrder;

export {
  // configuration
  ChainId,
  configurator,
  filters,
  ExecutorLaunchConfig,

  // environment
  environments,
  setCurrentEnvironment,

  // hooks
  Hooks,

  // The following exports are required to support legacy ExecutorLaunchConfig v2
  CURRENT_ENVIRONMENT,
  WsNextOrder,
};
