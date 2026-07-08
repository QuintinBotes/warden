# Proposal: Device Cloud Grid & Parallel Sharding

- **Status:** Draft (design proposal) · **Date:** 2026-07-08 · **Relates to:** [warden-next-competitive-gaps.md](./2026-07-08-warden-next-competitive-gaps.md) §1.2

## Summary

Warden today drives one browser engine per run and treats real devices as scaffolding (the
`AppiumBrowserSession` exists but is headless-only, with no way to reach a real iPhone or a Safari
build). This proposal adds a **`GridProvider` seam** — `local` Playwright projects, BrowserStack,
Sauce Labs, or LambdaTest, selected by config — plus a **pure shard planner** that fans the tier the
orchestrator already selected across N CI shards, and a **lane-aware CTRF merge** that folds the
shard reports back into one report the existing gate and reporters consume unchanged. Because Warden
already speaks CTRF, merge is cheap; because real-device runs route through the provider's
Appium/WebDriver endpoint, the existing `AppiumBrowserSession` becomes real cross-browser and
real-device coverage at scale instead of a stub.

## Motivation

"Does it pass on Safari / iOS / Android?" is a release-blocking question Warden cannot answer at
scale today. The gap analysis (§1.2, **verified 3-of-3**) puts this squarely in Tier 1 table stakes:
**BrowserStack** ships 3,500+ real devices and ~3,500 browser-OS combinations with ~10× parallel
speedup and auto failure-classification; **Sauce Labs** offers ~7,500 real iOS/Android devices plus
~1,700 emulators with native Appium/Espresso/XCUITest; **LambdaTest** covers the same ground; and the
OSS baseline is **Playwright `--shard`** orchestrated by tools like **Currents.dev**. Warden's
`expandMatrix` already computes a browser × device matrix and `mergeCtrf` already merges tiers — what
is missing is (a) a provider seam that can provision a lane on a real grid and (b) a planner that
turns the matrix into a fan-out CI job set and merges the results back with per-lane provenance.

## Goals

1. Introduce a `GridProvider` contract in `@warden/core` (additive, alongside `BrowserEngine` /
   `Reporter`) with `local`, `browserstack`, `saucelabs`, and `lambdatest` adapters selected by
   config, credentials read from the environment (never from config).
2. Fan the **already-selected tier** (`selectTiers` output) across N CI shards × the resolved lane
   matrix with a **pure, deterministic** shard planner, so re-runs reproduce the same lane→shard
   assignment.
3. Route real-device lanes through the provider's Appium/WebDriver endpoint by reusing the existing
   `AppiumBrowserSession` / `WebdriverLike` seam — no new session type for mobile.
4. Merge per-shard CTRF back into one report that carries **per-lane provenance** (which browser /
   device each result ran on) so the merge gate and the four GitHub surfaces need no changes.
5. Keep the `local` provider zero-infra and fully hermetic — the default path needs no cloud account
   and no network.

## Non-Goals

- Native app (`.apk`/`.ipa`) upload and pure-native automation — this proposal targets web +
  mobile-web on real devices; native binaries are follow-up.
- A hosted Warden grid of our own. We integrate the incumbents' grids; we do not build one.
- Changing the merge-gate semantics. A P1 failure on any lane already blocks under the existing
  `evaluateExitCriteria`; the grid only widens the surface those rules see.
- Per-lane flake attribution (`test × lane`) — the current flake quarantine keys on test id; keying
  on lane is noted as follow-up (relates to §1.4).

## Architecture

One new package (`@warden/grid`) plus small additive extensions to `@warden/core` and
`@warden/runner`. The orchestrator is untouched: it already produces the tier list and change
surface the planner consumes.

### New: `@warden/grid`

The grid engine as small isolated units. No provider makes a network call of its own inside the pure
units; every HTTP / WebDriver collaborator is injected, so the whole engine is unit-testable without
a live grid.

The seam itself lives in `@warden/core` (contract surface, like `BrowserEngine`):

```ts
// @warden/core/src/grid.ts (additive)

/** One resolvable target lane: a browser (× version) on a platform, optionally a real device. */
export interface GridCapability {
  /** Stable lane id, e.g. 'browserstack:safari-17:iphone-15' or 'local:webkit'. */
  id: string;
  browser: 'chromium' | 'firefox' | 'webkit' | 'safari' | 'edge';
  browserVersion?: string;
  platform: 'windows' | 'macos' | 'linux' | 'ios' | 'android';
  platformVersion?: string;
  /** Real-device model, e.g. 'iPhone 15'. Absent for desktop browsers. */
  device?: string;
  /** True for a real device / real browser build; false for an emulator/simulator or headless. */
  real: boolean;
}

export interface GridCapabilityRequest {
  browsers: GridCapability['browser'][];
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

export type LaneOutcome = 'passed' | 'failed' | 'error';

export interface GridProvider {
  name: 'local' | 'browserstack' | 'saucelabs' | 'lambdatest';
  /** Resolve the lanes this provider can currently serve for the requested matrix. */
  capabilities(request: GridCapabilityRequest): Promise<GridCapability[]>;
  /** Provision one remote session for a capability; returns the endpoint the runner connects to. */
  openSession(capability: GridCapability, opts: BrowserLaunchOptions): Promise<GridSessionInfo>;
  /** Release the session and report the final pass/fail back to the provider. */
  closeSession(info: GridSessionInfo, outcome: LaneOutcome): Promise<void>;
}
```

The shard-plan types are additive to `@warden/core` too, mirroring `ChangeSurface` / `TestTier`:

```ts
// @warden/core/src/grid.ts (additive, continued)

export interface ShardAssignment {
  /** 1-based CI shard index and total, materialized as `playwright test --shard 3/8`. */
  index: number;
  total: number;
  playwrightShard: string; // '3/8'
  /** The lane this shard runs. */
  lane: GridCapability;
  /** Tier tag grep passed through from `selectTiers`, e.g. '@smoke'. */
  grep?: string;
}

export interface ShardPlan {
  lanes: GridCapability[];
  shards: ShardAssignment[];
  /** Lanes requested but not servable this run (capacity / removed device), stated in the summary. */
  skippedLanes: Array<{ capability: GridCapability; reason: string }>;
}
```

### Extended (additive, no breaking changes)

- **`@warden/core`** — the `grid.ts` types above and an additive `grid` block on
  `WardenConfigSchema`. `BrowserLaunchOptions` is reused as-is.
- **`@warden/runner`** — `RunPlaywrightOptions` gains `shard?: string` and `connectUrl?: string`
  (both optional, so existing calls are unchanged); a new `createGridWebdriver(endpoint, capability,
http)` builds a `WebdriverLike` pointed at a grid endpoint, so the **existing**
  `createAppiumSession` drives a real device with no new session class.

### Units in `@warden/grid`

| Unit                   | Does                                                                                                                                          | Depends on                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `LocalGridProvider`    | `capabilities()` maps `grid.matrix` to local Playwright project lanes via `expandMatrix`; `openSession` returns a local endpoint. No network. | core, `@warden/runner` (`expandMatrix`) |
| `BrowserStackProvider` | `capabilities`/`openSession`/`closeSession` over an **injected** HTTP + WebDriver client; credentials from env.                               | core, injected `GridHttpClient`         |
| `SauceLabsProvider`    | Same seam, Sauce REST + Appium/WebDriver endpoints.                                                                                           | core, injected `GridHttpClient`         |
| `LambdaTestProvider`   | Same seam, LambdaTest endpoints.                                                                                                              | core, injected `GridHttpClient`         |
| `createGridProvider`   | `(config.grid, deps) → GridProvider` — selects the adapter; throws `ConfigError` on missing credentials **before any lane runs**.             | core, providers                         |
| `planShards`           | `(PlanShardsInput) → ShardPlan` — **pure**; crosses lanes × tier tags, fans across `maxShards`, balances by injected history.                 | core                                    |
| `stampLane`            | `(CTRFReport, GridCapability) → CTRFReport` — writes a `@grid:<laneId>` tag + `extra.grid` (browser/device/real/replay) onto each `CTRFTest`. | core (CTRF)                             |
| `mergeLaneReports`     | `(reports, capabilities) → CTRFReport` — `stampLane` each, then reuse `@warden/reporter`'s `mergeCtrf`, preserving lane provenance.           | core, `@warden/reporter` (`mergeCtrf`)  |

```ts
// @warden/grid/src/plan-shards.ts
export interface PlanShardsInput {
  capabilities: GridCapability[];
  /** Tier tags from the orchestrator's `selectTiers`, e.g. ['@smoke', '@apps/checkout']. */
  tierTags: string[];
  /** CI fan-out ceiling; lanes × shards collapse to this (documented, not silent). */
  maxShards: number;
  balanceBy: 'duration' | 'count';
  /** Injected per-tag historical durations (from @warden/test-management); empty → round-robin. */
  history?: Record<string, number>;
}

export function planShards(input: PlanShardsInput): ShardPlan;
```

`GridHttpClient` is a minimal injected interface (POST/GET JSON + a `connect(endpoint)` handle). The
real implementations live behind `createGridProvider`; tests inject fakes.

## Configuration

Additive `grid` block on `WardenConfigSchema`, every field defaulted so existing configs stay valid.
Credentials are **never** in config — each cloud provider reads its own env vars
(`BROWSERSTACK_USERNAME` / `BROWSERSTACK_ACCESS_KEY`, `SAUCE_USERNAME` / `SAUCE_ACCESS_KEY`,
`LT_USERNAME` / `LT_ACCESS_KEY`), exactly like the AI provider keys.

```ts
grid: {
  enabled: false,                       // off by default; `local` needs no cloud account
  provider: 'local',                    // 'local' | 'browserstack' | 'saucelabs' | 'lambdatest'
  maxShards: 1,                         // CI fan-out ceiling per tier
  balanceBy: 'duration',                // 'duration' (uses history) | 'count' (round-robin)
  matrix: {
    browsers: ['chromium'],             // MatrixBrowser[] locally; capability browsers on cloud
    devices: [],                        // real-device models on cloud grids, e.g. ['iPhone 15']
  },
  project: undefined,                   // provider build/project name stamp (cloud only)
  region: undefined,                    // provider region hint (cloud only)
}
```

Example — a payment app that must pass on real Safari/iOS on merge:

```ts
grid: {
  enabled: true,
  provider: 'browserstack',
  maxShards: 8,
  matrix: { browsers: ['chromium', 'webkit', 'safari'], devices: ['iPhone 15', 'Pixel 8'] },
  project: 'checkout-release',
}
```

## Data flow

1. PR opens → `warden-action` triggers Warden. `@warden/orchestrator` computes the `ChangeSurface`
   and `selectTiers(surface, cfg)` → e.g. `['smoke', 'selective']`, with the tier tags to grep.
2. `createGridProvider(cfg.grid, deps)` selects `Local | BrowserStack | Sauce | LambdaTest`;
   missing cloud credentials throw `ConfigError` up front.
3. `provider.capabilities({ browsers, devices })` (from `cfg.grid.matrix`) resolves the live lanes —
   desktop browsers, plus real devices flagged `real: true`.
4. `planShards({ capabilities, tierTags, maxShards, balanceBy, history })` → a `ShardPlan`: lanes ×
   tier tags fanned across `maxShards`, each `ShardAssignment` carrying `playwright --shard i/n`, its
   `grep`, and its lane. Unservable lanes land in `skippedLanes`.
5. `warden-action` materializes the `ShardPlan` as a CI job matrix (N parallel jobs). Each job:
   1. `provider.openSession(capability, launchOpts)` → an endpoint. Desktop → a Playwright
      **connect URL**; real device → a WebDriver endpoint wrapped by `createGridWebdriver` →
      `createAppiumSession` (the existing session, unchanged).
   2. `runPlaywright({ grep, shard, connectUrl, env })` → a per-shard CTRF report.
   3. `stampLane(report, capability)` writes lane provenance onto each test; the job uploads the CTRF
      artifact and calls `provider.closeSession(info, outcome)` in a `finally`.
6. A merge job runs `aggregate(reportsDir)` (existing) → `mergeLaneReports(reports, capabilities)` →
   **one** merged CTRF, lane provenance intact in per-test `tags` + `extra.grid`.
7. `@warden/reporter` renders per-lane grouping across the four GitHub surfaces ("failed only on
   `webkit` / `iOS-real`") and the dashboard replay links to each lane's provider `replayUrl`.
8. `evaluateExitCriteria(results, cfg)` returns `BLOCK / WARN / PASS` over the merged results — a P1
   on **any** lane blocks. `MetricsEmitter.emitExecution` fires per lane and `emitGate` once.

## Units & files

| File                                                   | Responsibility                                                                                                       | Deps                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `packages/core/src/grid.ts`                            | Additive `GridProvider`, `GridCapability`, `GridSessionInfo`, `LaneOutcome`, `ShardAssignment`, `ShardPlan` types.   | core                  |
| `packages/core/src/config.ts` _(extend)_               | Additive `grid` block on `WardenConfigSchema` with defaults.                                                         | zod                   |
| `packages/grid/src/create-grid-provider.ts`            | Factory: `cfg.grid.provider` → adapter; `ConfigError` on missing env credentials.                                    | core, providers       |
| `packages/grid/src/providers/local.ts`                 | `LocalGridProvider` — matrix → local Playwright project lanes via `expandMatrix`; no network.                        | core, runner          |
| `packages/grid/src/providers/browserstack.ts`          | `BrowserStackProvider` over an injected `GridHttpClient`; env credentials.                                           | core, injected client |
| `packages/grid/src/providers/saucelabs.ts`             | `SauceLabsProvider` — Sauce REST + Appium endpoints.                                                                 | core, injected client |
| `packages/grid/src/providers/lambdatest.ts`            | `LambdaTestProvider` — LambdaTest endpoints.                                                                         | core, injected client |
| `packages/grid/src/plan-shards.ts`                     | Pure `planShards(input): ShardPlan` — lanes × tags fanned across `maxShards`, balanced by history.                   | core                  |
| `packages/grid/src/stamp-lane.ts`                      | `stampLane(report, capability)` — lane id/replay onto each `CTRFTest` (`tags` + `extra.grid`).                       | core                  |
| `packages/grid/src/merge-lanes.ts`                     | `mergeLaneReports(reports, caps)` — stamp then reuse `mergeCtrf`.                                                    | core, reporter        |
| `packages/grid/src/index.ts`                           | Package surface (providers, `createGridProvider`, `planShards`, `stampLane`, `mergeLaneReports`).                    | —                     |
| `packages/runner/src/mobile/grid-webdriver.ts` _(new)_ | `createGridWebdriver(endpoint, capability, http): WebdriverLike` — points `AppiumBrowserSession` at a grid endpoint. | core, injected http   |
| `packages/runner/src/run-playwright.ts` _(extend)_     | Add optional `shard` + `connectUrl` to `RunPlaywrightOptions`.                                                       | —                     |

## Safety & error handling

- **Credentials are env-only** — cloud providers never read secrets from `warden.config`. A cloud
  `provider` with missing env credentials throws `ConfigError` from `createGridProvider` **before any
  lane is provisioned** (fail fast, spend nothing).
- **Local stays zero-infra** — `provider: 'local'` (the default) makes no network calls and keeps the
  whole path hermetic; teams without a grid account keep working exactly as today.
- **Capacity / queueing** — `openSession` retries with bounded backoff; a lane that still cannot be
  provisioned is recorded in `ShardPlan.skippedLanes` and rendered in the summary — **never silently
  dropped** — while the other lanes proceed.
- **No session leaks** — `closeSession` always runs in a `finally`; on a job crash the provider's
  session TTL reaps the orphan.
- **Deterministic planning** — `planShards` is pure and deterministic given `(capabilities, history)`,
  so a re-run reproduces the lane→shard assignment; with no history it falls back to round-robin by
  count. `maxShards` caps CI fan-out (collapse is documented, not silent).
- **Real-device is deterministic-only** — `AppiumBrowserSession.act`/`extract` already throw
  `BrowserError`; generated specs that target real-device lanes must use role/label locators, matching
  the existing mobile constraint.
- **Least surprise on cost** — a `--dry-run` prints the resolved `ShardPlan` (lane count, shard count)
  before any paid minutes are spent.

## Testing

Fully hermetic, matching the rest of Warden — every provider's network/WebDriver collaborator is an
injected fake, and the pure units run on fixtures:

- **`planShards`** — pure: fixture `capabilities` + `tierTags` + `history` → asserted `ShardPlan`
  (lane→shard assignment, `playwright --shard` strings, `maxShards` collapse, round-robin fallback
  when `history` is empty, populated `skippedLanes`).
- **`stampLane` / `mergeLaneReports`** — fixture CTRF reports + capabilities → merged report asserts a
  `@grid:<laneId>` tag and `extra.grid` on every `CTRFTest`, and that the merged counts equal the
  reporter's `mergeCtrf` output (no double counting).
- **`LocalGridProvider`** — `cfg.grid.matrix` → `capabilities()` equals `expandMatrix` output;
  `openSession` returns a local endpoint; asserts **zero** network access.
- **Cloud providers** — inject a fake `GridHttpClient` (in the spirit of the existing Appium
  `WebdriverLike` fake): assert the `capabilities`/`openSession`/`closeSession` request payloads, that
  credentials come from an injected env, and that a queue-full response surfaces as a `skippedLane` —
  all with no live grid.
- **`createGridProvider`** — provider selection per config; `ConfigError` on missing credentials.
- **`grid-webdriver`** — a fake `http` handle → `createGridWebdriver` builds a `WebdriverLike`;
  `createAppiumSession` drives it; asserts the endpoint + capability are sent and deterministic
  `click`/`fill` route through.
- Wiring uses `@warden/core/testing` fakes (`fakeProvider`, `fakeReporter`, `fixtureChangeSurface`);
  a real grid account is exercised only in a dogfood run.

## Rollout

1. **Core + local sharding.** Additive `grid.ts` types + config block + `planShards` +
   `stampLane`/`mergeLaneReports` + `LocalGridProvider` — all pure/hermetic. Local matrix sharding
   (Playwright `--shard` × the browser matrix) works end-to-end in CI with zero new infra.
2. **Real-device local path.** `createGridWebdriver` wires the existing `AppiumBrowserSession` to a
   self-hosted Appium/WebDriver endpoint — proves the real-device route before any cloud.
3. **Cloud adapters.** BrowserStack first, then Sauce Labs, then LambdaTest — same seam, injected
   clients, credentials via env.
4. **CI + dashboard.** `warden-action` materializes the `ShardPlan` as a CI job matrix + a merge job;
   the dashboard surfaces per-lane provider `replayUrl`.
5. **Docs.** Grid config + per-provider setup in `docs/`.

## Risks & open items

- **Playwright-connect vs WebDriver per provider.** Desktop cross-browser prefers the provider's
  Playwright **connect** endpoint where available; providers exposing only WebDriver route those lanes
  through the Appium path, which is deterministic-only (no AI `act`/`extract`). Documented per
  provider.
- **Cost / quota.** Parallel real-device minutes are metered; `maxShards` + `matrix` caps bound spend,
  and `--dry-run` prints the plan first — but budget governance across teams is an open operational
  question.
- **CTRF environment vs per-test provenance.** The reporter's `mergeCtrf` currently drops the
  top-level `environment`, so lane provenance deliberately rides on per-test `tags` + `extra.grid`. If
  richer per-lane environment is later needed, `mergeCtrf` gains an additive lane-aware mode.
- **Capability drift.** Provider device/browser catalogs change; `capabilities()` resolves live and
  surfaces unknown/removed devices as `skippedLanes` rather than hard failures.
- **Cross-lane flake attribution.** A test failing only on one real device may be lane-specific, not a
  regression. The current flake quarantine keys on test id; extending the key to `test × lane` is
  follow-up (relates to §1.4).
