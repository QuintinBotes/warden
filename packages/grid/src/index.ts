/**
 * `@warden/grid` — the device-cloud grid engine.
 *
 * A pure shard planner ({@link planShards}) fans the selected tier across N CI shards × the
 * resolved lane matrix; {@link createGridProvider} selects a {@link LocalGridProvider} or one of the
 * cloud adapters (BrowserStack / Sauce Labs / LambdaTest) over an injected HTTP client; and
 * {@link mergeLaneReports} folds the per-shard CTRF reports back into one report with per-lane
 * provenance the existing gate and reporters consume unchanged.
 *
 * The grid **contract** types (`GridProvider`, `GridCapability`, `ShardPlan`, …) live in
 * `@warden/core` and are re-exported here for convenience.
 */

export { createGridProvider, type CreateGridProviderDeps } from './create-grid-provider';

export { planShards, type PlanShardsInput } from './plan-shards';
export { stampLane, gridTag, GRID_TAG_PREFIX, type LaneProvenance } from './stamp-lane';
export { mergeLaneReports } from './merge-lanes';

export { LocalGridProvider } from './providers/local';
export {
  CloudGridProvider,
  type CloudProviderSpec,
  type CloudProviderDeps,
  type CatalogEntry,
  type OpenSessionResponse,
} from './providers/cloud-base';
export { BrowserStackProvider, BROWSERSTACK_SPEC } from './providers/browserstack';
export { SauceLabsProvider, sauceSpec } from './providers/saucelabs';
export { LambdaTestProvider, LAMBDATEST_SPEC } from './providers/lambdatest';

export {
  defaultGridHttpClient,
  GridCapacityError,
  type GridHttpClient,
  type GridConnection,
} from './http-client';

// Re-export the grid contract types from core for ergonomic single-import consumption.
export type {
  GridProvider,
  GridBrowser,
  GridPlatform,
  GridCapability,
  GridCapabilityRequest,
  GridSessionInfo,
  LaneOutcome,
  ShardAssignment,
  ShardPlan,
  SkippedLane,
  GridConfig,
} from '@warden/core';
