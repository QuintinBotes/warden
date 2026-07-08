# Proposal: Flaky-Test Intelligence

- Status: Draft (design proposal) · Date: 2026-07-08 · Relates to: warden-next-competitive-gaps.md §1.4

## Summary

Warden already quarantines a flaky test once its rolling flake rate lands between 20% and 80%
(`computeFlakeRate` / `shouldQuarantine` in `@warden/test-management`), but it has no configurable
retry policy, no explanation for _why_ a test is flaky, and no history of flake volume over time.
This proposal adds a bounded, policy-driven retry pass; an LLM root-cause classifier that tags every
flake as `timing | selector | data | network | unknown`; a quantified per-test flakiness rate and
impact score; and a flake-trend panel on the dashboard (rate over time, MTTR-to-de-flake, top
offenders) — reusing the metrics pipeline Prometheus already carries.

## Motivation

Currents.dev computes a per-test **Flakiness Rate** (flaky results ÷ selected results) and a derived
**Flakiness Impact**, tracks the rate's change across time periods, and drives triage through
**"Currents Actions"** — pre/post-test hooks to skip/quarantine, dynamic tagging, owner assignment,
and expiring quarantines with an "Affected tests" view. BuildPulse, Datadog CI Test Visibility, and
Trunk offer variants of the same loop: detect → quantify → explain → auto-retry/quarantine → track
to resolution. Warden's `flakeFlag` and `shouldQuarantine` today are binary and retrospective: they
tell a reviewer a test _is_ flaky, not how often, why, or whether it's getting better. As flake
volume grows past a handful of tests, "quarantine and move on" stops being triage and starts hiding a
real reliability problem — this is precisely the gap the market has already standardized around
(§1.4 of the competitive analysis).

## Goals

1. A configurable retry policy — max retries, backoff, and an option to retry _only_ tests already
   known to be flaky (not blindly retry every failure, which hides real regressions).
2. A flake root-cause classifier that tags each retry-resolved flake with a category and an
   explanation, using the same `LLMProvider` + tool-call pattern as the existing healer strategy.
3. A quantified per-test flakiness rate and an **impact score** (re-runs caused, CI minutes lost,
   gate blocks avoided) — not just a boolean quarantine flag.
4. A flake-trend view: rate over time, MTTR-to-de-flake (time from first flagged to quarantine
   cleared), and a ranked "top offenders" list, fed by the same Prometheus pipeline
   `@warden/observability` already pushes to.
5. Fully additive to `@warden/core`; every new unit hermetically testable with injected
   collaborators — no live browser, network, or LLM in unit tests.

## Non-Goals

- Auto-fixing the flaky test's code (that's the healer strategy's `proposedFix`, unchanged here).
- Cross-repo flake correlation (a shared component flaky in two repos) — future work, would build on
  `@warden/coverage-sync`'s `dependents` links.
- Replacing Playwright's own `--retries` mechanism outright; Warden's policy sits _above_ it and adds
  the "only known-flaky" and classification behavior Playwright doesn't have.
- A UI for manually overriding a classification — first version is read-only; corrections happen by
  re-running the classifier, not by hand-editing.

## Architecture

No new package. Extends `@warden/core` (types + config), `@warden/test-management` (retry/flake
domain logic + storage), `@warden/agent` (the classifier), `@warden/observability` (metrics), and
`@warden/dashboard-api` (the trend queries) — plus the `@warden/cli` composition point that already
runs a tier and converts its CTRF report into a `TestExecution`.

### `@warden/core` — additive types (new module `flake-intelligence.ts`, re-exported from `index.ts`)

```ts
// packages/core/src/flake-intelligence.ts
import { z } from 'zod';
import type { TestResult } from './schema';
import type { FailureContext } from './agent';
import type { LLMProvider } from './llm';
import type { WardenConfig } from './config';
import type { FlakeStat, DashboardDataApi, TrendPoint } from './v2';

export const FlakeRootCause = z.enum(['timing', 'selector', 'data', 'network', 'unknown']);
export type FlakeRootCause = z.infer<typeof FlakeRootCause>;

export interface FlakeClassification {
  testCaseId: string;
  rootCause: FlakeRootCause;
  confidence: number; // 0-1
  explanation: string;
  classifiedAt: Date;
}

/** What the classifier receives: recent chronological history plus the last failing attempt. */
export interface FlakeClassifierInput {
  testCaseId: string;
  recentResults: TestResult[]; // chronological, most recent last
  latestFailure: FailureContext;
}

export interface FlakeClassifier {
  classify(
    input: FlakeClassifierInput,
    provider: LLMProvider,
    cfg: WardenConfig,
  ): Promise<FlakeClassification>;
}

/** Quantified cost of a test's flakiness — Currents' "Flakiness Impact" analog. */
export interface FlakeImpact {
  testCaseId: string;
  reRunsCaused: number; // retry attempts this test triggered across recent executions
  ciMinutesLost: number; // sum of retry-attempt durations, converted to minutes
  gateBlocksAvoided: number; // executions that would have BLOCKed without the retry pass
}

export interface FlakeTrendPoint {
  at: Date;
  flakeRate: number; // fraction of results flaky/retried-to-pass in the window ending `at`
  newlyFlagged: number; // tests newly quarantined in the window
  deflaked: number; // tests whose quarantine cleared in the window
}

/** One row of the dashboard's flake board — additive superset of the existing `FlakeStat`. */
export interface FlakeBoardEntry extends FlakeStat {
  impact: FlakeImpact;
  rootCause?: FlakeRootCause;
  mttrHours?: number; // time from first-quarantined to cleared, for the most recent episode
}

/** Additive dashboard surface; a `DashboardDataApi` implementation may also implement this. */
export interface FlakeIntelligenceDataApi extends DashboardDataApi {
  flakeBoardDetailed(): Promise<FlakeBoardEntry[]>;
  topOffenders(n: number): Promise<FlakeBoardEntry[]>;
  flakeTrend(range: { from: Date; to: Date }): Promise<FlakeTrendPoint[]>;
}

export type { TrendPoint };
```

These are additive: `FlakeBoardEntry` widens `FlakeStat` with new fields rather than changing it, and
`FlakeIntelligenceDataApi` is a new interface that _extends_ `DashboardDataApi` rather than modifying
it — an existing `DashboardDataApi` implementation keeps compiling untouched.

### `@warden/core` — additive config (`WardenConfigSchema`)

```ts
flake: z
  .object({
    retry: z
      .object({
        enabled: z.boolean().default(true),
        maxRetries: z.number().int().min(0).max(5).default(2),
        backoffMs: z.number().int().nonnegative().default(1000),
        backoffMultiplier: z.number().positive().default(2),
        // If true, only retry tests already in the quarantine list; a fresh failure
        // is reported as a real FAIL, not silently retried away.
        retryOnlyKnownFlaky: z.boolean().default(false),
      })
      .default({}),
    classifier: z
      .object({
        enabled: z.boolean().default(true),
        // Skip the LLM call below this confidence-worthy history length; too little
        // history makes root-cause guesses unreliable.
        minHistoryForClassification: z.number().int().nonnegative().default(3),
      })
      .default({}),
    gate: z
      .object({
        // WARN (never BLOCK on its own) when a PR's tier run newly quarantines more
        // tests than this in one run — signals a quality regression, not just noise.
        warnOnNewlyQuarantinedAbove: z.number().int().nonnegative().default(2),
      })
      .default({}),
  })
  .default({}),
```

`WardenConfigSchema` already carries `gates.flakeQuarantineAfterRuns` (V1); this block is new and
additive, sitting alongside it — the quarantine _threshold_ stays where it is, this is retry/
classification/trend behavior layered on top.

### `@warden/test-management` — retry & flake domain logic

`src/flake.ts` already exports `computeFlakeRate` and `shouldQuarantine`. It gains pure, hermetic
additions (no I/O):

```ts
// packages/test-management/src/flake.ts (additions)
import type { CTRFReport } from '@warden/core';

/** Which of a run's failing test names should be retried, given the policy and known-flaky set. */
export function selectRetryCandidates(
  failedTestNames: string[],
  opts: { retryOnlyKnownFlaky: boolean; knownFlaky: ReadonlySet<string> },
): string[] {
  if (!opts.retryOnlyKnownFlaky) return failedTestNames;
  return failedTestNames.filter((name) => opts.knownFlaky.has(name));
}

export interface RetryReconciliation {
  /** The reconciled CTRF report: one entry per test, last attempt's status wins. */
  report: CTRFReport;
  /** Per test name: how many extra attempts ran, and whether an earlier attempt failed. */
  meta: Map<string, { retries: number; flakeFlag: boolean }>;
}

/**
 * Folds an original CTRF report plus zero or more retry-attempt CTRF reports (each scoped
 * to the failing subset) into one reconciled report. A test's final status is its LAST
 * attempt; `flakeFlag` is true when an earlier attempt failed but a later one passed.
 * Pure — no clock reads, no I/O — so retry sequences are trivial to construct as fixtures.
 */
export function reconcileRetries(attempts: CTRFReport[]): RetryReconciliation {
  /* ... */
}

/** Impact of a test's flake history: retries it caused, CI time lost, gate blocks avoided. */
export function computeFlakeImpact(
  testCaseId: string,
  history: TestResult[], // chronological, most recent last
): FlakeImpact {
  /* ... */
}

/** Hours between the first result of the flaky episode ending at `clearedAt` and `clearedAt`. */
export function computeMttrToDeflake(
  events: { testCaseId: string; event: 'quarantined' | 'cleared'; at: Date }[],
  testCaseId: string,
): number | undefined {
  /* ... */
}
```

`SqliteStore` (`src/sqlite-store.ts`) gains two small tables and matching methods, following the
existing pattern (`saveRequirement`/`getRequirements`, `saveTestPlan`/`getTestPlan`):

```ts
saveFlakeClassification(c: FlakeClassification): void;
getFlakeClassification(testCaseId: string): FlakeClassification | undefined;

recordQuarantineEvent(e: { testCaseId: string; event: 'quarantined' | 'cleared'; at: Date }): void;
listQuarantineEvents(testCaseId?: string): { testCaseId: string; event: 'quarantined' | 'cleared'; at: Date }[];
```

`flake_classifications` stores the latest classification per `testCaseId` (upsert, like
`requirements`); `flake_quarantine_events` is append-only — each row a single transition, written by
the CLI composition point (below) whenever `shouldQuarantine` flips for a test. Both are schema-
validated JSON-column tables, matching `requirements`/`test_plans`.

### `@warden/agent` — the classifier

A new file, sibling to `healer-strategy.ts`, using the exact same `generateWithTools` + tool-call
pattern (not a new `AgentStrategy` member — like `CoverageRecommender`, this is a standalone seam
with its own factory, since it classifies a _history_, not a single diff/failure):

```ts
// packages/agent/src/flake-classifier.ts
import type {
  FlakeClassification,
  FlakeClassifier,
  FlakeClassifierInput,
  LLMProvider,
  Tool,
  WardenConfig,
} from '@warden/core';

const CLASSIFY_FLAKE_TOOL: Tool = {
  name: 'classify_flake',
  description: 'Classify the root cause of a test that failed then passed across retries.',
  inputSchema: {
    type: 'object',
    properties: {
      rootCause: { type: 'string', enum: ['timing', 'selector', 'data', 'network', 'unknown'] },
      confidence: { type: 'number', description: '0 to 1.' },
      explanation: { type: 'string', description: 'Why this category, citing the error/history.' },
    },
    required: ['rootCause', 'explanation'],
  },
};

export function createFlakeClassifier(): FlakeClassifier {
  return {
    async classify(
      input: FlakeClassifierInput,
      provider: LLMProvider,
      cfg: WardenConfig,
    ): Promise<FlakeClassification> {
      const prompt = buildPrompt(input);
      const result = await provider.generateWithTools(prompt, [CLASSIFY_FLAKE_TOOL], {
        systemPrompt: FLAKE_CLASSIFIER_SYSTEM_PROMPT,
        model: cfg.ai.model,
      });
      const call = result.toolCalls.find((c) => c.name === 'classify_flake');
      return call ? toClassification(input.testCaseId, call.input) : fallbackClassification(input);
    },
  };
}
```

`fallbackClassification` mirrors the healer's regex fallback: `timeout|wait|slow` → `timing`;
`selector|locator|strict mode|detached|not visible` → `selector`; `ECONNREFUSED|ECONNRESET|fetch
failed|network|DNS` → `network`; a numeric/text assertion mismatch with no timing/selector/network
hints → `data`; otherwise `unknown`. This guarantees every flake gets _some_ tag even if the provider
is unavailable, the same graceful-degradation posture as `HealerStrategy`.

### `@warden/observability` — metrics

`MetricsEmitter` (in `v2.ts`) gains one new **optional** method — additive, since existing
implementers of the interface (e.g. a custom `MetricsEmitter` a repo already wrote) keep compiling
without it:

```ts
export interface MetricsEmitter {
  emitExecution(execution: TestExecution): Promise<void>;
  emitGate(decision: GateDecision, meta: { pr?: number; module?: string }): Promise<void>;
  emitFlakeClassification?(classification: FlakeClassification): Promise<void>;
}
```

A new pure formatter, sibling to `format-execution-metrics.ts`:

```ts
// packages/observability/src/format-flake-metrics.ts
export function formatFlakeClassificationMetrics(c: FlakeClassification): PushedMetric[] {
  // warden_flake_root_cause_total{cause="selector"} (counter, one increment)
  // warden_flake_classification_confidence{test_case_id} (gauge, c.confidence)
}
```

`PrometheusMetricsEmitter.emitFlakeClassification` pushes these through the existing
`PrometheusPusher` seam (`prom-client-pusher.ts`) — no new transport.

### `@warden/dashboard-api` — the trend queries

`SqliteDashboardApi` (already implements `DashboardDataApi` over `SqliteStore`) implements the new
`FlakeIntelligenceDataApi` methods, reusing `getRecentExecutions`/`listExecutions` exactly as
`flakeBoard`/`trends` already do:

```ts
async flakeBoardDetailed(): Promise<FlakeBoardEntry[]> { /* flakeBoard() + impact + classification + mttr per test */ }
async topOffenders(n: number): Promise<FlakeBoardEntry[]> { /* flakeBoardDetailed() sorted by impact.ciMinutesLost desc, sliced to n */ }
async flakeTrend(range: DateRange): Promise<FlakeTrendPoint[]> { /* bucket listExecutions(range) by day; per bucket: flake rate + quarantine-event counts from listQuarantineEvents */ }
```

### `@warden/cli` — the composition point (retry loop + reconciliation)

`runRun` (`packages/cli/src/run-run.ts`) currently runs a tier exactly once and hardcodes
`retries: 0, flakeFlag: false` in `ctrfToExecution`. This is where the policy actually executes,
since `@warden/cli` is the only package that already depends on `runner` + `test-management` +
`reporter` + `observability` together:

1. Run the tier once (unchanged `runTests` call).
2. If `cfg.flake.retry.enabled` and the report has `failed` tests: build the known-flaky set from
   `store.getRequirements()`'s linked test cases run through `shouldQuarantine`, compute
   `selectRetryCandidates`, and — for up to `maxRetries` rounds with `backoffMs *
backoffMultiplier^attempt` between rounds — re-invoke `runTests` scoped to just those test names
   (Playwright's exact-title `--grep`).
3. `reconcileRetries([original, ...retryAttempts])` → one CTRF report + per-test retry/flake meta.
4. `ctrfToExecution` (extended with an optional `retryMeta` map) stamps each `TestResult.retries` /
   `.flakeFlag` from step 3 instead of the current hardcoded `0`/`false`.
5. For each test where `flakeFlag` flipped true and `cfg.flake.classifier.enabled`, call
   `FlakeClassifier.classify` with `store.getRecentExecutions(testCaseId, N)` + the _first_ failing
   attempt's error/stack (captured before reconciliation discards it) and `store.saveFlakeClassification`.
6. Recompute `shouldQuarantine` per affected test; on a flip, `store.recordQuarantineEvent`.
7. `MetricsEmitter.emitFlakeClassification` for each new classification (no-op if the emitter doesn't
   implement it).

## Data flow

1. A PR triggers a tier run (unchanged: orchestrator selects tiers, `@warden/cli run` executes one).
2. `runTests` runs once; if `cfg.flake.retry.enabled` and there are failures, up to `maxRetries`
   bounded, backed-off retry rounds run — scoped to `selectRetryCandidates` (all failures, or only
   tests already in `shouldQuarantine`'s quarantine list, per `retryOnlyKnownFlaky`).
3. `reconcileRetries` folds the attempts into one CTRF report; `ctrfToExecution` stamps real
   `retries`/`flakeFlag` per `TestResult` instead of the current hardcoded zero/false.
4. For each newly-flaky test, `FlakeClassifier.classify` (LLM + heuristic fallback) tags a root
   cause; `SqliteStore.saveFlakeClassification` persists it, `recordQuarantineEvent` logs any
   quarantine-state transition.
5. `MetricsEmitter.emitExecution` (existing) and the new `emitFlakeClassification` push to
   Prometheus; Grafana panels read the same series the dashboard reads from SQLite.
6. The merge gate (unchanged BLOCK/WARN/PASS contract) adds one new WARN reason: a tier run that
   newly quarantines more tests than `cfg.flake.gate.warnOnNewlyQuarantinedAbove` — never a BLOCK on
   its own, since flake volume is a quality signal, not a correctness one.
7. The reconciled `TestExecution` is reported as usual (CTRF file, PR comment, job summary); the
   PR comment additionally notes "N flaky, auto-retried, tagged: 2 selector, 1 timing" when retries
   fired.
8. `@warden/dashboard-api`'s `SqliteDashboardApi` (already backing `apps/dashboard`'s
   `scripts/snapshot.mjs`) exposes `flakeBoardDetailed`/`topOffenders`/`flakeTrend`; the snapshot
   script shapes them into the JSON `dashboard-client.tsx` already renders, adding a "Flake trends"
   panel next to the existing "Flake & quarantine" block — a rate-over-time sparkline (reusing
   `TrendTile`'s `points` prop), an MTTR tile, and a ranked top-offenders table.

## Units & files

| File                                                       | Responsibility                                                                                                                                      | Deps                                                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/core/src/flake-intelligence.ts`                  | `FlakeRootCause`, `FlakeClassification(Input)`, `FlakeClassifier`, `FlakeImpact`, `FlakeTrendPoint`, `FlakeBoardEntry`, `FlakeIntelligenceDataApi`. | `./schema`, `./agent`, `./llm`, `./config`, `./v2`                                                        |
| `packages/core/src/config.ts`                              | Additive `flake` block (`retry`, `classifier`, `gate`) on `WardenConfigSchema`.                                                                     | zod                                                                                                       |
| `packages/core/src/v2.ts`                                  | `MetricsEmitter` gains optional `emitFlakeClassification`.                                                                                          | `./flake-intelligence`                                                                                    |
| `packages/test-management/src/flake.ts`                    | `selectRetryCandidates`, `reconcileRetries`, `computeFlakeImpact`, `computeMttrToDeflake` — all pure.                                               | `@warden/core`                                                                                            |
| `packages/test-management/src/sqlite-store.ts`             | `flake_classifications` + `flake_quarantine_events` tables and their get/save/list methods.                                                         | better-sqlite3, `@warden/core`                                                                            |
| `packages/agent/src/flake-classifier.ts`                   | `createFlakeClassifier()` — LLM classification + heuristic fallback.                                                                                | `@warden/core`, `./strategy-support`                                                                      |
| `packages/agent/src/prompts.ts`                            | `FLAKE_CLASSIFIER_SYSTEM_PROMPT` constant (sibling to `HEALER_SYSTEM_PROMPT`).                                                                      | —                                                                                                         |
| `packages/observability/src/format-flake-metrics.ts`       | Pure `FlakeClassification → PushedMetric[]` formatter.                                                                                              | `@warden/core`, `./types`                                                                                 |
| `packages/observability/src/prometheus-metrics-emitter.ts` | Implements `emitFlakeClassification` via the existing pusher.                                                                                       | `./format-flake-metrics`, `./prom-client-pusher`                                                          |
| `packages/dashboard-api/src/dashboard-api.ts`              | `SqliteDashboardApi` implements `flakeBoardDetailed`/`topOffenders`/`flakeTrend`.                                                                   | `@warden/test-management`, `@warden/core`                                                                 |
| `packages/cli/src/run-run.ts`                              | Retry loop: bounded rounds, `selectRetryCandidates`, `reconcileRetries`, classify-on-flip, quarantine-event logging, metrics.                       | `@warden/runner`, `@warden/test-management`, `@warden/agent`, `@warden/observability`, `@warden/reporter` |
| `packages/cli/src/ctrf-execution.ts`                       | `ctrfToExecution` accepts an optional `retryMeta` map to stamp real `retries`/`flakeFlag` (currently hardcoded).                                    | `@warden/core`                                                                                            |
| `apps/dashboard/scripts/snapshot.mjs`                      | Calls the new `SqliteDashboardApi` methods; shapes a `flakeTrends` block into `data.json`.                                                          | `@warden/dashboard-api`                                                                                   |
| `apps/dashboard/app/dashboard-client.tsx`                  | Renders the "Flake trends" panel: sparkline, MTTR tile, top-offenders table.                                                                        | `@warden/design-system`                                                                                   |

## Safety & error handling

- **Never silently hides a real regression.** `retryOnlyKnownFlaky: true` retries only tests already
  in the quarantine list; a fresh failure on a never-before-flaky test is reported as a hard `FAIL`,
  not retried away. Default is `false` (retry any failure) for teams that want maximum green-build
  friendliness, but the option exists precisely so a team can tighten it once flake volume is under
  control.
- **Bounded, not infinite.** `maxRetries` (≤5, enforced by the zod schema) with exponential backoff;
  a test that fails every attempt is reported as `FAIL`, never silently dropped.
- **Classifier degrades gracefully.** `LLMProvider` failure (timeout, missing key, `ProviderError`)
  falls back to the regex heuristic — the same posture as `HealerStrategy`'s `fallbackDiagnosis`. A
  flake is always tagged with _something_; classification never blocks the retry pass or the report.
- **Insufficient history is a real "unknown", not a guess.** Below `minHistoryForClassification`,
  the classifier still runs but the fallback path is used and `confidence` is capped at `0.3` — the
  dashboard visibly distinguishes "confidently classified" from "not enough data yet."
- **Retry rounds are isolated per test name.** `reconcileRetries` keys strictly by test identity
  (`contentId('TC', filePath::name)`, unchanged from `ctrfToExecution`), so a crash mid-retry-round
  degrades to "fewer attempts recorded," never cross-contaminates another test's status.
- **Storage is additive and independently failable.** `saveFlakeClassification` /
  `recordQuarantineEvent` failures throw `TestManagementError` (existing class) and are caught at the
  `run-run.ts` call site — a storage hiccup logs a warning and skips that test's classification for
  this run; it never fails the tier run or the gate.
- **Gate impact is capped at WARN.** `warnOnNewlyQuarantinedAbove` can only WARN, matching the
  existing `GateDecision` contract; flake volume alone never blocks a merge (a real regression still
  reaches `BLOCK` through the existing pass-rate/critical-finding gates, untouched).

## Testing

Fully hermetic, matching the rest of Warden — no live browser, network, or LLM:

- `selectRetryCandidates`: fixture failed-name lists × known-flaky sets → exact retry subset, for
  both `retryOnlyKnownFlaky: true` and `false`.
- `reconcileRetries`: fixture `CTRFReport[]` sequences (fail→pass, fail→fail→pass, fail→fail) →
  asserted final status, `retries` count, and `flakeFlag` per test name.
- `computeFlakeImpact` / `computeMttrToDeflake`: fixture result/event histories → exact numeric
  assertions (reRunsCaused, ciMinutesLost, mttrHours), including the "never quarantined" (`undefined`
  MTTR) and "still quarantined" (no `cleared` event) edge cases.
- `createFlakeClassifier`: `fakeProvider` from `@warden/core/testing` configured to return a
  `classify_flake` tool call → asserts the returned `FlakeClassification` matches; a second test
  configures `fakeProvider` to throw and asserts the heuristic fallback fires with the expected
  `rootCause` for representative error strings (timeout, "strict mode violation", "ECONNRESET",
  an assertion-value mismatch).
- `SqliteStore`: round-trip `saveFlakeClassification`/`getFlakeClassification` and
  `recordQuarantineEvent`/`listQuarantineEvents` against a temp-dir SQLite file (matching
  `sqlite-store.test.ts`'s existing pattern); asserts schema re-validation on read.
- `SqliteDashboardApi.flakeBoardDetailed` / `topOffenders` / `flakeTrend`: extend
  `dashboard-api.test.ts`'s seeded fixture (`seedStore`) with a classified, quarantined test case and
  quarantine-event rows → asserts impact numbers, sort order, and per-bucket trend points.
- `format-flake-metrics.ts`: fixture `FlakeClassification` → exact `PushedMetric[]` (name, type,
  labels, value), matching `format-execution-metrics.test.ts`'s style.
- `run-run.ts`: inject a fake `runTests` returning a scripted fail→pass sequence, a fake
  `FlakeClassifier`, an in-memory `SqliteStore` (temp dir), and a fake `MetricsEmitter`; asserts the
  final `TestExecution`'s `retries`/`flakeFlag`, that classification was saved, that a quarantine
  event was recorded on a flip, and that `emitFlakeClassification` was called — all without a real
  Playwright process or provider.

## Rollout

1. `@warden/core`: `flake-intelligence.ts` types + additive `flake` config block + the
   `MetricsEmitter.emitFlakeClassification` optional method. No behavior change yet.
2. `@warden/test-management`: `selectRetryCandidates`, `reconcileRetries`, `computeFlakeImpact`,
   `computeMttrToDeflake`, and the two new `SqliteStore` tables — all hermetically testable in
   isolation.
3. `@warden/agent`: `createFlakeClassifier()` + prompt + heuristic fallback.
4. `@warden/cli`: wire the retry loop into `run-run.ts` behind `cfg.flake.retry.enabled` (defaults
   `true`, so this is the first user-visible behavior change — retries fire automatically at the
   default `maxRetries: 2`).
5. `@warden/observability`: `format-flake-metrics.ts` + `PrometheusMetricsEmitter` wiring; new
   Grafana panel definitions in `deploy/` for flake rate and root-cause breakdown.
6. `@warden/dashboard-api` + `apps/dashboard`: the trend queries, `snapshot.mjs` changes, and the
   dashboard panel.
7. Document `flake.*` config in `docs/configuration.md`, including the `retryOnlyKnownFlaky`
   trade-off.

## Risks & open items

- **Retry rounds add CI time.** A test that's genuinely broken (not flaky) still pays
  `maxRetries × backoff` before it's reported as `FAIL` when `retryOnlyKnownFlaky: false`. Mitigated
  by the default `maxRetries: 2` and a short `backoffMs`, but a team with a lot of hard failures
  should flip `retryOnlyKnownFlaky: true` — called out explicitly in the config docs, not just left
  implicit.
- **Root-cause taxonomy is coarse.** Five buckets (`timing/selector/data/network/unknown`) won't
  capture every failure mode (e.g. animation/CSS-transition races land under `timing` even though
  they're a distinct class). Matches Currents' level of granularity for v1; a finer taxonomy is
  additive later since `FlakeRootCause` is a zod enum, not a hardcoded literal in call sites.
  Rather than tightening this in code, first validate the taxonomy holds up against several
  dogfooded repos' real flake histories before adding buckets.
- **MTTR needs a quarantine-event history to exist.** A repo migrating onto this feature has no
  prior `flake_quarantine_events` rows, so `computeMttrToDeflake` returns `undefined` for every test
  until at least one full quarantine→clear cycle happens post-migration; the dashboard states "not
  enough history yet" rather than showing a misleading zero.
- **Classifier cost.** An LLM call per newly-flagged flake is cheap at low flake volume but scales
  with it; `minHistoryForClassification` and the confidence cap curb wasted calls on thin history,
  but a very flake-heavy repo should be watched for cost before defaulting `classifier.enabled` to
  `true` fleet-wide.
