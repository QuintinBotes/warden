# Proposal: Critical User Journey (CUJ) Modeling

- Status: Draft (design proposal) · Date: 2026-07-08 · Relates to: warden-next-competitive-gaps.md §2.2

## Summary

This proposal makes the **Critical User Journey (CUJ)** a first-class entity in `@warden/core` — a
named, ordered, business-critical path through the product (sign-in → add-to-cart → checkout →
confirmation), owned by a team, and linked to the requirements and tests that exercise it. On top of
that entity, a new `@warden/cuj` package adds a **health rollup** (a CUJ's health is the worst of its
linked tests, optionally folded with a11y/perf/visual signals against SLO-style thresholds), a
**CUJ-scoped merge gate** (a change that degrades a journey it touches blocks the merge — not because
"a test failed" but because "checkout regressed"), and a **CUJ board** in the dashboard. The
exploratory agent gains a CUJ as its explicit mission brief, focusing "browse and break it" on the
journeys that actually matter. Everything is additive to `@warden/core`; the gate reuses the existing
`GateDecision` contract so it composes with the standard exit-criteria gate with no changes downstream.

## Motivation

Warden today answers "did the tests pass?" It cannot yet answer "**is _checkout_ safe to ship?**" —
the question a release owner actually asks. That question is a Critical User Journey question, and
CUJs are, as documented in §2.2 of the competitive gap analysis, a core SRE/observability construct:
Google SRE defines SLOs _on_ CUJs (journey completion rate, latency, drop-off), Splunk markets CUJ
monitoring for production, and a widely-cited microservices engineering case study keeps user-journey
SLOs current with E2E tests spanning many services. The gap the analysis calls out is that **almost
no QA _tool_ models CUJs as first-class** — the incumbents (mabl, Testim, Applitools, BrowserStack)
stop at the test/suite level and leave "which journey does this failure belong to, and did it get
worse?" for a human to reconstruct from a wall of green and red. §2.2 frames this as both a gap to
fill and a lead to take: a CUJ layer lets the merge gate reason about business journeys instead of
raw pass counts, focuses the AI exploratory agent on the highest-value paths, and — combined with the
requirement→test→execution model Warden already has — makes the gate answer "is this feature safe to
ship?" a level above the test-pass gates most CI tools offer. Warden already computes the change
surface, tracks per-requirement coverage, and returns a BLOCK/WARN/PASS gate; a CUJ is the missing
aggregation layer that ties those to the journeys a product actually sells.

## Goals

1. A first-class, validated `Cuj` entity in `@warden/core`: name, ordered steps, owning team, linked
   requirements + tests, business tier, and optional SLO-style thresholds — authored as YAML and
   loaded like test cases, so a CUJ is versioned alongside the code.
2. A pure **CUJ health rollup**: `Cuj` + its linked tests' latest results (+ optional a11y/perf/visual
   signals) → a `HEALTHY | DEGRADED | BROKEN | NOT_TESTED` report with per-step detail, following a
   documented worst-of rule.
3. A **CUJ-scoped merge gate**: for the CUJs a change _touches_, compare after-health against a
   baseline and return a `GateDecision` — BLOCK a tier-1 regression, WARN a tier-2 one — that composes
   with the existing `evaluateExitCriteria` gate (worst-of wins).
4. The **exploratory agent takes a CUJ as its mission brief**: when a tier-1 CUJ is touched, the
   agent explores that journey's ordered steps instead of a bare URL, and reports findings against it.
5. A **CUJ board** in the dashboard: every CUJ, its current health, per-step status, owning team, and
   trend — the "are our journeys green?" view.
6. Fully additive and hermetic: no V1 signature changes; every collaborator that touches IO
   (the YAML source, the baseline store, the provider) is injected, so the whole engine is unit-testable
   with fakes.

## Non-Goals

- **Production SLO monitoring / synthetic uptime checks.** This gates _merges_ and reports CUJ health
  in CI and the dashboard; it does not run continuous production probes or page on burn-rate. (CUJ
  health computed here is a natural feeder for such a system later, but it is out of scope.)
- **Auto-discovering CUJs.** First version consumes hand-authored CUJ YAML. Proposing CUJs from
  production-traffic clustering (§2.5) or from the requirement graph is future work.
- **Defining new visual/a11y/perf tiers.** The rollup _consumes_ an already-evaluated `CujSignal[]`
  from whatever tier produced it (§1.1, §1.7); it does not implement those tiers. Until they land the
  rollup is purely test-based, and the signal seam is the additive hook for when they do.
- **A separate CUJ gate contract.** The CUJ gate deliberately returns the existing `GateDecision` so
  it plugs into the current gate/merge/plugin flow rather than introducing a parallel one.

## Architecture

One new package, plus small additive extensions to `@warden/core`, `@warden/agent`,
`@warden/dashboard-api`, and `@warden/cli`.

### New `@warden/core` types (additive): `packages/core/src/cuj.ts`

The domain entity and its rollup/gate value types, schema-first exactly like `schema.ts` — the Zod
schema is the source of truth and the TS type is inferred, so runtime validation and compile-time
types cannot drift. Exported from `index.ts` via `export * from './cuj'`.

```ts
import { z } from 'zod';
import type { ChangeSurface, GateDecision } from './change-surface';
import type { TestResult } from './schema';

/** Business criticality — drives how hard the gate reacts to a regression. */
export const CujTier = z.enum(['tier1', 'tier2', 'tier3']);
export type CujTier = z.infer<typeof CujTier>;

/** Rolled-up health of a journey or one of its steps. */
export const CujHealthStatus = z.enum(['HEALTHY', 'DEGRADED', 'BROKEN', 'NOT_TESTED']);
export type CujHealthStatus = z.infer<typeof CujHealthStatus>;

/** SLO-style thresholds, all optional; unset means "tests alone decide health". */
export const CujThresholdsSchema = z
  .object({
    minPassRatePercent: z.number().default(100),
    maxP95LatencyMs: z.number().optional(),
    requireA11y: z.boolean().default(false),
    maxVisualDiffRatio: z.number().optional(),
  })
  .default({});
export type CujThresholds = z.infer<typeof CujThresholdsSchema>;

/** One ordered step in a journey, linked to the tests/requirements that exercise it. */
export const CujStepSchema = z.object({
  order: z.number().int().nonnegative(),
  name: z.string(), // e.g. "Add item to cart"
  module: z.string().optional(), // a test tag, e.g. '@apps/checkout' — ties into the change surface
  testIds: z.array(z.string()).default([]), // TestCase ids covering this step
  requirementIds: z.array(z.string()).default([]),
});
export type CujStep = z.infer<typeof CujStepSchema>;

export const CujSchema = z.object({
  id: z.string(), // e.g. "CUJ-checkout"
  name: z.string(), // e.g. "Guest checkout"
  description: z.string().optional(),
  owningTeam: z.string(), // a free-form team slug for routing/notification, not an identity system
  tier: CujTier.default('tier1'),
  steps: z.array(CujStepSchema).default([]),
  requirementIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]), // module/test tags this journey spans
  thresholds: CujThresholdsSchema,
});
export type Cuj = z.infer<typeof CujSchema>;

/**
 * An already-evaluated non-functional signal, emitted by whatever tier produced it (a11y/perf/visual).
 * `passed` is the tier's own verdict; `blocking` lets a signal escalate to BROKEN instead of DEGRADED.
 */
export interface CujSignal {
  kind: 'a11y' | 'perf' | 'visual';
  step?: string; // step name it applies to, or undefined for the whole journey
  value: number; // p95 ms, violation count, diff ratio, ...
  passed: boolean;
  blocking?: boolean;
}

export interface CujStepHealth {
  order: number;
  name: string;
  status: CujHealthStatus;
}

/** The rolled-up health of one CUJ, ready for the gate, the reporter, and the dashboard board. */
export interface CujHealthReport {
  cujId: string;
  name: string;
  owningTeam: string;
  tier: CujTier;
  status: CujHealthStatus;
  passRatePercent: number;
  steps: CujStepHealth[];
  failingSignals: CujSignal[];
  computedAt: string; // ISO timestamp
}

/** A CUJ the current change surface intersects, with why it matched. */
export interface TouchedCuj {
  cuj: Cuj;
  matchedTags: string[]; // the change-surface tags/modules that intersected this CUJ
  reason: string;
}
```

### New package `@warden/cuj`

The CUJ engine, as small isolated units. No filesystem, database, or network of its own — the YAML
source, the baseline execution history, and the provider are all injected, so every unit is
unit-testable with fakes, matching the `FileAccess`/`GitHubAccess`/`fakeProvider` pattern used
elsewhere.

| Unit                    | Does                                                                                                                                                                                                                                         | Depends on                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `CujRegistry`           | `load(dir) → Cuj[]` — read + parse + validate `.warden/cuj/*.yaml` via an injected `CujSource`, indexing by id and by module/tag. Invalid files raise `WardenError('E_CUJ_INVALID')` and are skipped, never crash the run.                   | core, injected `CujSource`, js-yaml |
| `resolveTouchedCujs`    | `(ChangeSurface, Cuj[]) → TouchedCuj[]` — a pure intersection of `changeSurface.testTags`/`changedModules` with each CUJ's `tags` and its steps' `module`. This is what makes the CUJ gate _scoped_: only journeys a change touches gate it. | core                                |
| `computeCujHealth`      | `(Cuj, latestResults, signals?) → CujHealthReport` — the worst-of rollup (below), pure and deterministic.                                                                                                                                    | core                                |
| `CujBaselineResolver`   | `(TouchedCuj[], baseRef, ExecutionHistory) → CujHealthReport[]` — the before-health for the touched CUJs, read from the base branch's last execution via an injected history port.                                                           | core, injected `ExecutionHistory`   |
| `evaluateCujGate`       | `({ touched, before, after, cfg }) → GateDecision` — per-CUJ before/after comparison folded into one BLOCK/WARN/PASS, most-severe-wins (mirrors `evaluateExitCriteria`).                                                                     | core                                |
| `mergeGateDecisions`    | `(...GateDecision[]) → GateDecision` — worst-of composition so the CUJ gate and the standard exit-criteria gate combine into the single decision the merge flow already consumes.                                                            | core                                |
| `renderCujMissionBrief` | `(Cuj) → string` — renders a journey as the exploratory agent's mission-brief prompt block (ordered steps, thresholds, owning team), bounded in size.                                                                                        | core                                |
| `index.ts`              | Public exports + `createCujEngine(io)` factory (mirrors `createProvider`/`createEngine` in sibling packages).                                                                                                                                | all of the above                    |

Two minimal injected ports keep the engine hermetic (both have a real impl in `@warden/cli`; tests
use hand-written fakes):

```ts
// @warden/cuj — injected seams

/** Read access to the CUJ YAML definitions (fs in prod, an in-memory map in tests). */
export interface CujSource {
  list(dir: string): Promise<string[]>;
  read(path: string): Promise<string>;
}

/** The base-branch results the baseline resolver needs — a subset of SqliteStore. */
export interface ExecutionHistory {
  /** Latest result per test case on `ref`, restricted to `testIds`. */
  latestForRef(ref: string, testIds: string[]): Promise<TestResult[]>;
}
```

Signatures of the pure core:

```ts
export function resolveTouchedCujs(surface: ChangeSurface, cujs: Cuj[]): TouchedCuj[];

export function computeCujHealth(
  cuj: Cuj,
  latestResults: TestResult[],
  signals?: CujSignal[],
): CujHealthReport;

export function evaluateCujGate(input: {
  touched: TouchedCuj[];
  before: CujHealthReport[];
  after: CujHealthReport[];
  cfg: WardenConfig;
}): GateDecision;

export function mergeGateDecisions(...decisions: GateDecision[]): GateDecision;
export function renderCujMissionBrief(cuj: Cuj): string;
```

**The worst-of rollup (`computeCujHealth`).** Following the same "latest result per test case" logic
as `computeCoverage` in `@warden/test-management`:

- No linked test has a result → `NOT_TESTED`.
- Any linked test's latest result is `FAIL` (or `BLOCKED`) → `BROKEN`.
- Else pass rate = passed / linked-with-results; `passRatePercent < thresholds.minPassRatePercent`
  → `DEGRADED`.
- A `CujSignal` with `passed: false` → `DEGRADED` (or `BROKEN` if `blocking`); an **absent** signal
  (its tier didn't run) never downgrades — absence is not failure.
- Otherwise `HEALTHY`. Per-step status is the worst-of that step's own `testIds`.

**The CUJ gate (`evaluateCujGate`).** For each touched CUJ, compare `after` to its `before`:

- `after` is `BROKEN` and `cfg.cuj.gate.blockOnBroken` → **BLOCK**.
- `after` worse than `before` (a regression) → **BLOCK** for a `tier1` CUJ, **WARN** for `tier2`,
  informational PASS for `tier3` (configurable).
- Baseline missing (a brand-new CUJ, first adoption) → a regression cannot be _proven_, so a degrade
  only **WARN**s; a `BROKEN` still blocks (a broken journey is bad regardless of history).
- `after` equal to or better than `before` → **PASS**.

The per-CUJ decisions fold most-severe-wins into one `GateDecision`, whose `reason` names the journey
(`"Blocked: tier-1 journey 'Guest checkout' regressed HEALTHY → BROKEN."`), and `mergeGateDecisions`
combines it with the standard exit-criteria gate.

### Additive `@warden/core` extension: `AgentInput.cuj`

Exactly the additive-optional-field pattern the fixtures proposal (§1.3) uses — existing callers are
unaffected:

```ts
// packages/core/src/agent.ts — additive optional field
export interface AgentInput {
  provider: LLMProvider;
  browser?: BrowserSession;
  diff?: DiffFile[];
  changeSurface?: ChangeSurface;
  url?: string;
  failure?: FailureContext;
  config: WardenConfig;
  /** When set, the exploratory strategy treats this journey as its mission brief. */
  cuj?: Cuj;
}
```

### Additive dashboard seam: `CujBoardApi`

Rather than change the existing `DashboardDataApi` interface (which would break `SqliteDashboardApi`),
the board gets its own small sibling interface — additive by construction:

```ts
// packages/core/src/cuj.ts (co-located with the entity)
export interface CujBoardApi {
  cujBoard(): Promise<CujHealthReport[]>;
}
```

`@warden/dashboard-api` adds a `SqliteCujBoardApi` implementing it over the same `SqliteStore` the
existing dashboard API already uses (CUJ defs + `getRecentExecutions` per linked test → per-CUJ
`CujHealthReport`), and `apps/dashboard` adds a `/cuj` board route. No existing dashboard code changes.

### Extended `@warden/agent` (behavior only, no core change)

`ExploratoryStrategy.run` reads `input.cuj` when present: it prepends `renderCujMissionBrief(cuj)` to
the exploration prompt and walks the journey's ordered steps (using each step's `module`/`name` to
steer the injected `BrowserSession`) instead of a single `input.url`. When `input.cuj` is absent the
strategy behaves exactly as today — fully backward-compatible.

## Configuration

Additive `warden.config` block, all fields defaulted, `enabled: false` at the top so zero-config
repos are unaffected:

```ts
cuj: {
  enabled: false,
  dir: '.warden/cuj/',            // where Cuj YAML defs live (loaded like tests/cases/)
  gate: {
    enabled: true,               // the CUJ gate only runs when a CUJ is actually touched
    blockOnBroken: true,         // any touched CUJ that is BROKEN blocks the merge
    blockTier1OnDegrade: true,   // a tier-1 journey regressing (not just broken) blocks
    warnTier2OnDegrade: true,    // a tier-2 regression warns
  },
  signals: {                     // fold non-functional signals into health when those tiers run
    a11y: false,
    perf: false,
    visual: false,
  },
  exploratory: {
    missionBriefTier: 'tier1',   // feed the exploratory agent a touched CUJ at/above this tier
  },
}
```

Because the gate only fires for _touched_ CUJs and defaults to off, adopting CUJs is incremental: a
team can define one journey and gate only it, with no effect on any other repo or PR.

## Data flow

1. A PR opens → `@warden/orchestrator` computes the `ChangeSurface` (changed modules, test tags,
   affected routes, risk) exactly as today.
2. `CujRegistry.load('.warden/cuj/')` reads the CUJ YAML defs via the injected `CujSource` → `Cuj[]`.
   Malformed defs are skipped with a WARN annotation; the rest proceed.
3. `resolveTouchedCujs(changeSurface, cujs)` → the `TouchedCuj[]` this change intersects (tag/module
   intersection). No touched CUJs → the CUJ gate is a neutral PASS and steps 6–8 are skipped.
4. Tier selection is enriched: the union of the touched CUJs' step `testIds`/`tags` is added to the
   selective tier so every touched journey is actually exercised (a CUJ becomes a first-class
   selection driver alongside the diff tags). If the exploratory tier fires and a touched CUJ is at or
   above `cuj.exploratory.missionBriefTier`, that CUJ is passed as `AgentInput.cuj`.
5. `@warden/runner` executes the selected tiers (Playwright/Claude-Chrome/Stagehand) and converts to
   CTRF → `TestResult[]`, unchanged. Any a11y/perf/visual tier that ran emits its `CujSignal[]`.
6. For each touched CUJ, `computeCujHealth(cuj, latestResults, signals)` → after-health;
   `CujBaselineResolver` reads the base ref's last execution via `ExecutionHistory` → before-health.
7. `evaluateCujGate({ touched, before, after, cfg })` → a `GateDecision`, then
   `mergeGateDecisions(exitCriteriaDecision, cujDecision)` → the single decision the merge flow
   consumes. Plugins' existing `onGateDecision` hook fires with it — no plugin API change.
8. The reporter surfaces per-CUJ health in the PR comment and job summary (reusing the existing
   surfaces): each touched journey with its `HEALTHY/DEGRADED/BROKEN` badge, per-step status, and the
   before→after transition that drove the gate. `MetricsEmitter` emits a per-CUJ health gauge.
9. The dashboard CUJ board (`SqliteCujBoardApi` → `/cuj`) renders every CUJ's current health, its
   steps, owning team, and health trend over time.

## Units & files

| File                                                 | Responsibility                                                                                                                                               | Deps                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `packages/core/src/cuj.ts`                           | `Cuj`, `CujStep`, `CujThresholds`, `CujTier`, `CujHealthStatus`, `CujSignal`, `CujStepHealth`, `CujHealthReport`, `TouchedCuj`, `CujBoardApi` types/schemas. | zod, change-surface + schema types |
| `packages/core/src/agent.ts` _(extended)_            | Additive optional `AgentInput.cuj` field.                                                                                                                    | none (type only)                   |
| `packages/core/src/config.ts` _(extended)_           | Additive `cuj` config block on `WardenConfigSchema`.                                                                                                         | zod                                |
| `packages/core/src/index.ts` _(extended)_            | `export * from './cuj'`.                                                                                                                                     | —                                  |
| `packages/cuj/src/registry.ts`                       | `CujRegistry` — load + parse + validate + index CUJ YAML via injected `CujSource`.                                                                           | core, js-yaml                      |
| `packages/cuj/src/resolve-touched.ts`                | `resolveTouchedCujs` — change surface ∩ CUJs.                                                                                                                | core                               |
| `packages/cuj/src/health.ts`                         | `computeCujHealth` — the pure worst-of rollup + per-step status.                                                                                             | core                               |
| `packages/cuj/src/baseline.ts`                       | `CujBaselineResolver` — before-health from an injected `ExecutionHistory`.                                                                                   | core                               |
| `packages/cuj/src/gate.ts`                           | `evaluateCujGate` + `mergeGateDecisions`.                                                                                                                    | core                               |
| `packages/cuj/src/mission-brief.ts`                  | `renderCujMissionBrief` — CUJ → exploratory prompt block.                                                                                                    | core                               |
| `packages/cuj/src/ports.ts`                          | `CujSource`, `ExecutionHistory` injected interfaces.                                                                                                         | core                               |
| `packages/cuj/src/index.ts`                          | Public exports + `createCujEngine(io)` factory.                                                                                                              | all of the above                   |
| `packages/agent/src/exploratory-strategy.ts` _(ext)_ | Prepend `renderCujMissionBrief` and walk the journey's steps when `input.cuj` is set; unchanged otherwise.                                                   | cuj (type only)                    |
| `packages/dashboard-api/src/cuj-board.ts`            | `SqliteCujBoardApi implements CujBoardApi` over the existing `SqliteStore`.                                                                                  | test-management, cuj, core         |
| `apps/dashboard/…/cuj`                               | The CUJ board route/view (health, steps, owner, trend).                                                                                                      | dashboard-api                      |
| `packages/cli/src/*` _(extended)_                    | Real `CujSource` (fs) + `ExecutionHistory` (SqliteStore) impls; wires steps 2–8 into the run and folds the CUJ gate into the final decision.                 | cuj, test-management               |

## Safety & error handling

- **Off and scoped by default.** `cuj.enabled: false` and the gate only fires for _touched_ CUJs, so
  adopting the feature can never block a PR that changes an unrelated journey — and a repo with no CUJ
  defs behaves exactly as today.
- **Malformed CUJ YAML degrades, never crashes.** `CujRegistry` validates each file against
  `CujSchema`; an invalid def raises `WardenError('E_CUJ_INVALID', ...)`, is skipped, and is listed in
  the run's WARN annotations — the other CUJs and the whole run still proceed.
- **No-baseline never causes a false BLOCK.** A first-ever or brand-new CUJ has no before-health; the
  gate cannot _prove_ a regression, so a degrade only WARNs. Only an outright `BROKEN` blocks in that
  case (and only when `blockOnBroken`). This keeps first-adoption from tripping the gate on itself.
- **Absent signals are not failures.** If the a11y/perf/visual tier didn't run, its signal is simply
  absent and never downgrades health; only an actually-evaluated `passed: false` signal does.
- **Dangling links surface, they don't hide.** A step referencing a `testId` with no result is
  `NOT_TESTED` (shown per-step on the board and in the report), not silently treated as passing — so
  coverage gaps in a journey are visible rather than masked.
- **Pure gate and rollup.** `computeCujHealth`, `resolveTouchedCujs`, `evaluateCujGate`, and
  `mergeGateDecisions` are deterministic pure functions; only `CujRegistry` (fs) and
  `CujBaselineResolver` (store) touch IO, both behind injected ports.
- **Composes, never replaces.** The CUJ gate returns a standard `GateDecision` merged worst-of with
  `evaluateExitCriteria`; it can only make the gate _stricter_, never override a BLOCK the exit
  criteria already raised.

## Testing

Fully hermetic, matching the rest of Warden — every collaborator is injected, no fs/network/LLM in
unit tests:

- `CujRegistry`: an in-memory `CujSource` fake serving fixture YAML → correctly parsed + tag-indexed
  `Cuj[]`; a malformed file → `WardenError('E_CUJ_INVALID')` while the valid ones still load.
- `resolveTouchedCujs`: `fixtureChangeSurface()` (from `@warden/core/testing`) crossed with CUJ
  fixtures → the expected touched set on a tag match, on a step-`module` match, and empty on a disjoint
  change (proving the gate is genuinely scoped).
- `computeCujHealth`: `TestResult` fixtures → `HEALTHY / DEGRADED / BROKEN / NOT_TESTED` per the
  worst-of rules; a failing `CujSignal` downgrades to `DEGRADED` (and to `BROKEN` when `blocking`); an
  absent signal leaves health unchanged; per-step status reflects each step's own tests.
- `CujBaselineResolver`: an injected fake `ExecutionHistory` → the expected before-health per touched
  CUJ; a missing base execution → `NOT_TESTED` before-health.
- `evaluateCujGate`: before/after `CujHealthReport` fixtures → BLOCK on broken, BLOCK on a tier-1
  degrade-from-healthy, WARN on a tier-2 degrade, WARN (not BLOCK) on a degrade with no baseline, PASS
  on unchanged/improved; asserts most-severe-wins aggregation across several touched CUJs.
- `mergeGateDecisions`: BLOCK+PASS → BLOCK, WARN+PASS → WARN, PASS+PASS → PASS, with the winning
  `reason` preserved.
- `renderCujMissionBrief`: a `Cuj` fixture → a prompt block containing every step in order, the
  thresholds, and the owning team, under a documented size cap.
- `ExploratoryStrategy` (extended): `fakeProvider()` + `fakeBrowserSession()` + `input.cuj` set →
  asserts the mission brief is in the captured prompt and the session visits the journey's steps; with
  `input.cuj` absent, asserts the prompt/behavior is byte-for-byte the current behavior (backward
  compatibility).
- `SqliteCujBoardApi`: a seeded `SqliteStore` + CUJ defs → `CujHealthReport[]` with correct per-CUJ and
  per-step status derived from the stored executions.

`CujSource`, `ExecutionHistory`, `fakeProvider`, and `fakeBrowserSession` are the injected doubles;
they are the same style of hand-written fake used across `@warden/coverage-sync` and `@warden/fixtures`.

## Rollout

1. Ship `@warden/core`'s additive types (`cuj.ts`, `AgentInput.cuj`, the `cuj` config block) and the
   `@warden/cuj` package — registry, `resolveTouchedCujs`, `computeCujHealth`, `CujBaselineResolver`,
   `evaluateCujGate`, `mergeGateDecisions`, `renderCujMissionBrief` — fully hermetically tested, with
   the gate defaulting off. No wiring, nothing user-visible yet.
2. Wire `@warden/cli`: load CUJ defs (fs `CujSource`), add touched-CUJ tags to selection, compute
   health, resolve the baseline (`SqliteStore` `ExecutionHistory`), and fold the CUJ gate into the
   final decision; surface per-CUJ health in the existing PR-comment / job-summary reporter. Dogfood on
   this repo with two CUJ defs (a checkout journey and a sign-in journey).
3. Feed the exploratory tier a touched tier-1 CUJ as its mission brief; add the `MetricsEmitter` CUJ
   health gauge and a Grafana panel.
4. Ship the dashboard CUJ board (`SqliteCujBoardApi` + the `apps/dashboard` `/cuj` route). Document
   `.warden/cuj/*.yaml` authoring, the health rollup, and the gate in `docs/`.
5. Once the visual (§1.1) and a11y/perf (§1.7) tiers land, wire their outputs as `CujSignal[]` into
   the rollup — no rollup change is needed, since the signal seam already accepts them behind the
   `cuj.signals.*` flags.

## Risks & open items

- **Baseline semantics.** Comparing after-health to the base ref's most-recent execution assumes the
  store holds a recent base-ref run. Branch-heavy or infrequently-run repos may want a "last green on
  the default branch" strategy instead; the first version uses most-recent-base-ref and degrades to a
  no-baseline WARN when absent (documented), with the richer strategy a follow-up.
- **Manual authoring at first.** CUJs are hand-declared YAML; a large product may find them tedious to
  keep current. Auto-suggesting CUJs from production-traffic clustering (§2.5) or the requirement graph
  is the natural next step and is explicitly out of scope here.
- **Step→test correlation depends on links.** A step with no linked test is `NOT_TESTED` and cannot
  gate; this is surfaced on the board and in the report so the gap is visible rather than a silent
  false-green, but it does mean CUJ gating is only as strong as the team's test links.
- **Threshold double-counting.** A perf/a11y tier has its own thresholds _and_ a CUJ can set
  `thresholds.maxP95LatencyMs` etc. To avoid confusing double-gating, the first version treats the
  tier's own pass/fail as the `CujSignal.passed` verdict and only _additionally_ applies CUJ-level
  thresholds when they are explicitly set on the journey.
- **Ownership is a routing hint, not identity.** `owningTeam` is a free-form slug used to route the
  gate decision to the right channel via existing `onGateDecision` plugins; it is intentionally not an
  auth/identity model.
