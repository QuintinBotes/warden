import { z } from 'zod';
import type { BrowserLaunchOptions } from './browser';

/**
 * The device-cloud **grid** contract surface (additive, alongside `BrowserEngine` / `Reporter`).
 *
 * A {@link GridProvider} resolves the lanes a run can target (a browser × platform, optionally a
 * real device), provisions one remote session per lane, and reports the lane's outcome back. The
 * `local` provider is zero-infra (no network); `browserstack` / `saucelabs` / `lambdatest` drive
 * the incumbents' grids over an injected HTTP client with credentials read from the environment.
 *
 * The **shard-plan** types ({@link ShardAssignment} / {@link ShardPlan}) mirror `ChangeSurface` /
 * `TestTier`: a pure planner fans the already-selected tier across N CI shards × the resolved lane
 * matrix, and a lane-aware CTRF merge folds the shard reports back with per-lane provenance.
 */

/** A grid-addressable browser. Superset of the local Playwright browsers, plus real Safari/Edge. */
export type GridBrowser = 'chromium' | 'firefox' | 'webkit' | 'safari' | 'edge';

/** The host platform a lane runs on. */
export type GridPlatform = 'windows' | 'macos' | 'linux' | 'ios' | 'android';

/** One resolvable target lane: a browser (× version) on a platform, optionally a real device. */
export interface GridCapability {
  /** Stable lane id, e.g. 'browserstack:safari-17:iphone-15' or 'local:webkit'. */
  id: string;
  browser: GridBrowser;
  browserVersion?: string;
  platform: GridPlatform;
  platformVersion?: string;
  /** Real-device model, e.g. 'iPhone 15'. Absent for desktop browsers. */
  device?: string;
  /** True for a real device / real browser build; false for an emulator/simulator or headless. */
  real: boolean;
}

/** The matrix of browsers (× optional real devices) a run asks a provider to resolve. */
export interface GridCapabilityRequest {
  browsers: GridBrowser[];
  /** Real-device model names to cross with the browsers (cloud grids only). */
  devices?: string[];
}

/** A provisioned remote session: the endpoint the runner drives + provider-hosted replay. */
export interface GridSessionInfo {
  capability: GridCapability;
  /** Playwright connect URL (desktop) or WebDriver endpoint (real device) for this lane. */
  endpoint: string;
  sessionId: string;
  /** Provider-hosted video/log replay URL, surfaced in the report + dashboard. */
  replayUrl?: string;
}

/** The terminal state of a lane, reported back to the provider on `closeSession`. */
export type LaneOutcome = 'passed' | 'failed' | 'error';

/**
 * The provider seam. `local`, `browserstack`, `saucelabs`, and `lambdatest` implement it; the
 * factory `createGridProvider(cfg.grid, deps)` selects one. Every network / WebDriver collaborator
 * is injected into the concrete adapter, so the whole surface is unit-testable without a live grid.
 */
export interface GridProvider {
  name: 'local' | 'browserstack' | 'saucelabs' | 'lambdatest';
  /** Resolve the lanes this provider can currently serve for the requested matrix. */
  capabilities(request: GridCapabilityRequest): Promise<GridCapability[]>;
  /** Provision one remote session for a capability; returns the endpoint the runner connects to. */
  openSession(capability: GridCapability, opts: BrowserLaunchOptions): Promise<GridSessionInfo>;
  /** Release the session and report the final pass/fail back to the provider. */
  closeSession(info: GridSessionInfo, outcome: LaneOutcome): Promise<void>;
}

/** One CI shard: a single lane running a Playwright `--shard index/total` slice of a tier tag. */
export interface ShardAssignment {
  /** 1-based Playwright shard index for this lane's slice; materialized as `--shard index/total`. */
  index: number;
  /** Total Playwright shards this lane's slice is split into. */
  total: number;
  /** The `--shard` string Playwright consumes, e.g. '3/8'. Always `${index}/${total}`. */
  playwrightShard: string;
  /** The lane this shard runs. */
  lane: GridCapability;
  /** Tier tag grep passed through from `selectTiers`, e.g. '@smoke'. */
  grep?: string;
}

/** One lane requested but not scheduled this run — never silently dropped. */
export interface SkippedLane {
  capability: GridCapability;
  reason: string;
}

/** The fully-resolved fan-out: which lanes run, the CI shards, and the lanes that were dropped. */
export interface ShardPlan {
  lanes: GridCapability[];
  shards: ShardAssignment[];
  /** Lanes requested but not servable this run (capacity / removed device), stated in the summary. */
  skippedLanes: SkippedLane[];
}

/**
 * The additive `grid` block on `WardenConfigSchema`. Every field is defaulted so existing configs
 * stay valid, and `enabled` defaults off — the default `local` provider needs no cloud account and
 * makes no network calls. **Credentials never live here**: each cloud provider reads its own env
 * vars (`BROWSERSTACK_USERNAME`/`BROWSERSTACK_ACCESS_KEY`, `SAUCE_USERNAME`/`SAUCE_ACCESS_KEY`,
 * `LT_USERNAME`/`LT_ACCESS_KEY`), exactly like the AI provider keys.
 */
export const GridConfigSchema = z
  .object({
    /** Off by default; `local` needs no cloud account. */
    enabled: z.boolean().default(false),
    provider: z.enum(['local', 'browserstack', 'saucelabs', 'lambdatest']).default('local'),
    /** CI fan-out ceiling per tier. */
    maxShards: z.number().int().positive().default(1),
    /** 'duration' uses injected per-tag history; 'count' fans round-robin. */
    balanceBy: z.enum(['duration', 'count']).default('duration'),
    matrix: z
      .object({
        /** MatrixBrowser[] locally; the wider capability browsers on cloud grids. */
        browsers: z
          .array(z.enum(['chromium', 'firefox', 'webkit', 'safari', 'edge']))
          .default(['chromium']),
        /** Real-device models on cloud grids, e.g. ['iPhone 15']. */
        devices: z.array(z.string()).default([]),
      })
      .default({}),
    /** Provider build/project name stamp (cloud only). */
    project: z.string().optional(),
    /** Provider region hint (cloud only). */
    region: z.string().optional(),
  })
  .default({});

export type GridConfig = z.infer<typeof GridConfigSchema>;
