# Proposal: Proactive Self-Healing (Optional Pre-Failure Locator Repair)

- Status: Draft (design proposal) · Date: 2026-07-08 · Relates to: warden-next-competitive-gaps.md §2.3

## Summary

This proposal adds an **optional** proactive pass that runs alongside Warden's existing
`HealerStrategy`: when a PR's change surface shows a UI change, Warden pre-emptively re-resolves
the role/label locators used by the tests it tags as affected against the new build's preview
deployment, and — for any locator that no longer resolves — opens a **draft healing PR** with the
minimal patch, _before_ the tests are run and go red. The default, reasoning healer (which classifies
a real failure as `regression` vs `maintenance` and explains why) is untouched and stays the default
behavior; this pass is off by default and additive.

## Motivation

mabl's "Adaptive Auto-Healing" and similar tools from Testim, Functionize, and testRigor update
locators **inline on every run**, and it is now the headline feature evaluators expect from a
"self-healing" test tool (§2.3, verified 3-of-3 that this capability exists in the market). Warden
already has a different, reactive answer: the `HealerStrategy` (`packages/agent/src/healer-strategy.ts`)
classifies a _failed_ test as a regression or a maintenance issue and proposes a fix, with an
explanation a reviewer can trust. Verification in §2.3 explicitly **refuted (0-of-3)** the claim that
continuous healing outperforms that reasoning approach — so Warden is not chasing a proven quality
gap, it is closing an **expectation/posture gap**. Teams that want the "it just fixes itself"
experience should be able to opt into a proactive pass without giving up the explainability of the
default healer, and without silently converting into an auto-heal-everything posture the maintainers
have not validated as strictly better.

Warden's role-based-locator convention (`BrowserSession.click(role, name)` /
`BrowserSession.fill(label, value)`, `page.getByRole` / `page.getByLabel` in
`packages/runner/src/playwright-engine.ts`) makes this tractable: locators are structured data, not
opaque CSS strings, so "does this locator still resolve in the new build?" is a mechanical check
before it is ever an LLM question.

## Goals

1. On a PR whose change surface touches UI (`affectedComponents` non-empty), extract the role/label
   locators used by the tests tagged as affected and re-resolve them against the PR's preview build.
2. For each locator that fails to resolve (`missing`) or now matches more than one element
   (`ambiguous`), use the LLM to propose the closest replacement locator from the live page, and
   package the result as a minimal patch.
3. Publish suggestions as a **draft PR** (never auto-committed to the source branch, never
   auto-merged) via the same `GitHubAccess` seam `@warden/coverage-sync` already uses, plus a neutral
   check-run summarizing what was checked and healed.
4. Track a **heal rate** metric (`resolved / (resolved + missing + ambiguous)`) per run, so teams can
   see whether the proactive pass is pulling its weight over time.
5. Be strictly additive and strictly optional: disabled by default, and never itself a gate input —
   it cannot turn a PASS into a BLOCK/WARN.
6. Reuse existing seams (`BrowserSession`, `LLMProvider`, `GitHubAccess`, `MetricsEmitter`,
   `ChangeSurface`) rather than inventing parallel infrastructure.

## Non-Goals

- Replacing or degrading the reactive `HealerStrategy`. It remains the default and the only healer
  that runs when `proactiveHealing.enabled` is `false`.
- Auto-applying any locator change to the source PR's branch, and auto-merging anything, ever.
- Healing anything beyond role/label locators (visual assertions, API contract assertions, data
  fixtures are out of scope — those are covered by other proposals, e.g. visual regression §1.1).
- Claiming proactive healing is empirically superior to reactive, reasoning-based healing. §2.3 found
  no evidence for that claim; this feature is offered as a posture option, and its docs say so.
- A general-purpose visual diffing or DOM-crawling engine. The pass only touches locators already
  referenced by existing tests — it does not invent new coverage.

## Architecture

New package **`@warden/proactive-healer`**, mirroring the shape of `@warden/coverage-sync`: small,
single-purpose units with every collaborator (browser, provider, GitHub, file access) injected, so
the whole pipeline is unit-testable without a live browser or a live GitHub. No new package is added
to `@warden/core` itself beyond additive types/seam extensions.

### Core additions (additive only)

New file `packages/core/src/proactive-heal.ts`, exported from `@warden/core`'s barrel like
`coverage-sync.ts` is:

```ts
import type { RepoTarget } from './coverage-sync';

/** One role/label locator call found in a test spec, with its source location. */
export interface LocatorRef {
  filePath: string;
  line: number;
  testCaseId?: string; // resolved from TestCase.automation.filePath/testName when known
  kind: 'click' | 'fill';
  role: string; // ARIA role for `click`; the label text for `fill` uses `role: 'label'`
  name: string; // accessible name / label text
}

export type LocatorStatus = 'resolved' | 'ambiguous' | 'missing';

export interface LocatorResolution {
  locator: LocatorRef;
  status: LocatorStatus;
  matchCount: number;
}

export interface ProactiveHealSuggestion {
  locator: LocatorRef;
  /** Best-guess replacement, proposed by the LLM from the live page's accessible roles/labels. */
  suggestedName: string;
  confidence: 'high' | 'medium' | 'low';
  patch: string; // unified diff against `locator.filePath`
  reason: string;
}

export interface HealRateSummary {
  checked: number;
  resolved: number;
  missing: number;
  ambiguous: number;
  suggested: number; // suggestions with a patch that parsed cleanly
  healRate: number; // resolved / checked, or 1 when checked === 0
}
```

`RepoTarget`, `GitHubAccess`, `FileAccess`, `PrRef`, `DraftPrResult` are **reused as-is** from
`packages/core/src/coverage-sync.ts` — the proactive healer opens its draft PR through the exact
same seam `@warden/coverage-sync` uses, so a single `GitHubAccess` implementation in
`@warden/github-app` (or the in-repo `@warden/cli`/`@warden/github-action` flow) serves both features.

Two additive extensions to existing core interfaces, both optional so no existing implementation
breaks:

```ts
// packages/core/src/browser.ts — additive optional method on BrowserSession
export interface BrowserSession {
  // ...existing members unchanged...
  /**
   * Non-mutating existence check for a role/label locator. Optional: engines that don't
   * implement it (or callers that don't need it) simply skip proactive healing.
   */
  locate?(kind: 'click' | 'fill', role: string, name: string): Promise<{ matchCount: number }>;
}
```

```ts
// packages/core/src/v2.ts — additive optional method on MetricsEmitter
export interface MetricsEmitter {
  // ...existing members unchanged...
  emitHeal?(
    summary: HealRateSummary,
    meta: { pr?: number; mode: 'proactive' | 'reactive' },
  ): Promise<void>;
}
```

`locate()` is implemented in `@warden/runner` for the Playwright engine as
`page.getByRole(role, { name }).count()` (and `page.getByLabel(label).count()` for `kind: 'fill'`) —
a direct extension of the existing `buildPlaywrightSession` mapping in
`packages/runner/src/playwright-engine.ts`, next to `click`/`fill`. It is not implemented for
`claude-chrome`/`stagehand` in v1 (AI-driven engines don't have a stable locator surface to probe);
`ProactiveHealRunner` (below) checks for the method and no-ops with a clear summary reason when it's
absent, exactly like `act()`/`extract()` already do for the Playwright engine in reverse.

### Units in `@warden/proactive-healer`

| Unit                     | Does                                                                                                                                                                                                                                                                                                                                                                                                             | Depends on                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `shouldRunProactiveHeal` | `(ChangeSurface, WardenConfig) → boolean` — true only when `proactiveHealing.enabled` and the surface has UI changes (`affectedComponents.length > 0` or a changed module matches `proactiveHealing.uiPatterns`).                                                                                                                                                                                                | core (`ChangeSurface`, `WardenConfig`)                                               |
| `LocatorExtractor`       | `(TestCase[], FileAccess) → LocatorRef[]` — reads each affected test's spec file (`automation.filePath`) and regex/AST-scans for `page.getByRole(role, { name })` / `session.click(role, name)` / `getByLabel(label)` / `session.fill(label, value)` call sites.                                                                                                                                                 | test-management (`TestCase`), injected `FileAccess`                                  |
| `LocatorResolver`        | `(LocatorRef[], BrowserSession) → LocatorResolution[]` — calls `session.locate(kind, role, name)` for each locator against a running preview session; `matchCount === 1` → `resolved`, `0` → `missing`, `>1` → `ambiguous`. Skips (with a stated reason) when `session.locate` is undefined.                                                                                                                     | core (`BrowserSession`)                                                              |
| `LocatorRepairSuggester` | `(LocatorResolution[], BrowserSession, LLMProvider) → ProactiveHealSuggestion[]` — for each non-`resolved` locator, reads the live page's accessible roles/labels via `session.extract(...)` and asks the provider (via a `propose_locator` tool, same `generateWithTools` shape as `HealerStrategy`'s `classify_failure`) to name the best match; builds a unified-diff `patch` against the original call site. | agent-style prompt, `LLMProvider`, `BrowserSession`                                  |
| `summarizeHealRate`      | `(LocatorResolution[], ProactiveHealSuggestion[]) → HealRateSummary` — pure aggregation, no I/O.                                                                                                                                                                                                                                                                                                                 | none                                                                                 |
| `ProactiveHealPublisher` | `(ProactiveHealSuggestion[], HealRateSummary, PrRef, GitHubAccess) → draft PR + check-run`, on branch `warden/proactive-heal-pr-<n>`; no-ops (neutral check only) when there is nothing to heal.                                                                                                                                                                                                                 | core (`GitHubAccess`) — same seam as `@warden/coverage-sync`'s `SuggestionPublisher` |
| `runProactiveHeal`       | Orchestrates the above: extract → resolve → suggest → summarize → publish → `emitHeal`. Every collaborator (`FileAccess`, `BrowserSession`, `LLMProvider`, `GitHubAccess`, `MetricsEmitter`) is a constructor/call argument.                                                                                                                                                                                     | all of the above                                                                     |

### Orchestrator integration (additive)

`@warden/orchestrator` gets one new pure function, `shouldRunProactiveHeal`, alongside the existing
`dispatchAgents` (`packages/orchestrator/src/dispatch-agents.ts`). It is called by the same PR
pipeline (CLI / `@warden/github-action`) that already calls `dispatchAgents`, _in parallel with_, not
instead of, the selective test tier — the proactive pass never blocks or delays the tier that
actually determines the gate decision. If the tier run later produces real `FAIL` results, those
still go through the existing reactive `HealerStrategy` unchanged; the proactive pass and the
reactive healer are independent and both may act on the same PR.

## Configuration

Additive `warden.config` block, disabled by default:

```ts
proactiveHealing: {
  enabled: false,
  // Extra module-path patterns (beyond a non-empty affectedComponents) that count as a UI change.
  uiPatterns: ['components/', 'pages/', 'app/'],
  // Where to reach the PR's live preview build; `{sha}` / `{pr}` are substituted.
  previewUrlTemplate: undefined as string | undefined,
  // Only touch locators used by tests tagged for the affected modules — never the whole suite.
  scopeToAffectedTags: true,
  // Skip a locator whose repair confidence is below this bar; it's left for the reactive healer.
  minConfidence: 'medium' as 'low' | 'medium' | 'high',
  // Cap on locators checked per run, to bound preview-session cost on large PRs.
  maxLocatorsPerRun: 200,
}
```

Defaults mean a repo that does nothing gets exactly today's behavior: only the reactive
`HealerStrategy` runs, on real failures. Turning this on requires both `enabled: true` and a
reachable `previewUrlTemplate` — without the latter, `runProactiveHeal` reports a neutral "no preview
URL configured" outcome rather than silently skipping.

## Data flow

1. PR opens/updates; `@warden/orchestrator` computes the `ChangeSurface` as it does today
   (`compute-change-surface.ts`).
2. `shouldRunProactiveHeal(surface, cfg)` returns `true` when `proactiveHealing.enabled` and the
   surface shows a UI change.
3. The PR pipeline resolves the affected `TestCase[]` (via `@warden/test-management`, scoped by
   `testTags` from the surface when `scopeToAffectedTags` is on) and calls
   `runProactiveHeal({ testCases, fileAccess, browserEngine, provider, gh, metrics, cfg, pr })`.
4. `LocatorExtractor` reads each affected test's spec file and produces `LocatorRef[]`.
5. A `BrowserSession` is launched against `previewUrlTemplate` (substituting the PR's head SHA/number)
   using the configured `browser.engine`; `LocatorResolver` calls `session.locate(...)` for every
   `LocatorRef`, capped at `maxLocatorsPerRun`.
6. For each `missing`/`ambiguous` result, `LocatorRepairSuggester` extracts the live page's
   accessible tree and asks the provider to name the closest replacement, producing a
   `ProactiveHealSuggestion` with a unified-diff `patch`, filtered by `minConfidence`.
7. `summarizeHealRate` produces the `HealRateSummary`.
8. `ProactiveHealPublisher` opens/updates a draft PR (`warden/proactive-heal-pr-<n>`) via
   `GitHubAccess.openOrUpdateDraftPr` containing every suggestion's patch, and posts a neutral
   check-run on the source PR summarizing checked/resolved/missing/ambiguous/healRate — this check
   never fails the build; it is informational only.
9. `MetricsEmitter.emitHeal(summary, { pr, mode: 'proactive' })` records the heal-rate metric (a
   Prometheus gauge, formatted by a new `format-heal-metrics.ts` in `@warden/observability`, alongside
   the existing `format-gate-metrics.ts`), so it shows up next to the gate-decision metric on the
   Grafana dashboard.
10. The PR's real test tiers run exactly as they do today, on the original (unmodified) source
    branch. If a test still fails, `HealerStrategy` classifies it — `emitHeal` is called a second
    time with `mode: 'reactive'` on that path (using the diagnosis's `kind`/`proposedFix` as the
    resolution signal), so the dashboard can compare proactive vs reactive heal rates side by side.
11. A human reviews the draft healing PR (if any) independently of the source PR's own review; merging
    it is a separate, ordinary human decision.

## Units & files

| File                                                        | Responsibility                                                                                   | Deps                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `packages/core/src/proactive-heal.ts`                       | `LocatorRef`, `LocatorResolution`, `ProactiveHealSuggestion`, `HealRateSummary` types.           | `coverage-sync.ts` (`RepoTarget`)        |
| `packages/core/src/browser.ts` (edit, additive)             | Adds optional `BrowserSession.locate()`.                                                         | none                                     |
| `packages/core/src/v2.ts` (edit, additive)                  | Adds optional `MetricsEmitter.emitHeal()`.                                                       | `proactive-heal.ts`                      |
| `packages/core/src/config.ts` (edit, additive)              | Adds the `proactiveHealing` schema block with defaults.                                          | zod                                      |
| `packages/orchestrator/src/should-run-proactive-heal.ts`    | Pure gate: surface + config → boolean.                                                           | core                                     |
| `packages/proactive-healer/src/locator-extractor.ts`        | Spec-file scan → `LocatorRef[]`.                                                                 | core, injected `FileAccess`              |
| `packages/proactive-healer/src/locator-resolver.ts`         | `LocatorRef[]` + `BrowserSession` → `LocatorResolution[]`.                                       | core                                     |
| `packages/proactive-healer/src/locator-repair-suggester.ts` | Resolution + live page + `LLMProvider` → `ProactiveHealSuggestion[]`.                            | core, `@warden/agent` prompt conventions |
| `packages/proactive-healer/src/summarize-heal-rate.ts`      | Pure aggregation → `HealRateSummary`.                                                            | core                                     |
| `packages/proactive-healer/src/publisher.ts`                | Suggestions + summary → draft PR + check-run via `GitHubAccess`.                                 | core                                     |
| `packages/proactive-healer/src/run.ts`                      | `runProactiveHeal(deps)` — wires the above; every collaborator injected.                         | all above                                |
| `packages/proactive-healer/src/testing-fakes.ts`            | Package-local fakes (fake `FileAccess`, fixture `LocatorRef[]`) built on `@warden/core/testing`. | core testing                             |
| `packages/runner/src/playwright-engine.ts` (edit, additive) | Implements `locate()` via `page.getByRole(...).count()` / `getByLabel(...).count()`.             | playwright                               |
| `packages/observability/src/format-heal-metrics.ts`         | `HealRateSummary` → `PushedMetric[]` (gauge), mirrors `format-gate-metrics.ts`.                  | core                                     |

## Safety & error handling

- **Off by default; two-key activation.** Requires `proactiveHealing.enabled: true` **and** a
  configured `previewUrlTemplate`; either missing produces a stated neutral outcome, never a silent
  no-op that looks like success.
- **Never touches the source branch.** All suggestions land in a separate draft PR
  (`warden/proactive-heal-pr-<n>`), exactly like coverage-sync's recommendations — never committed to
  the PR under review, never auto-merged.
- **Never a gate input.** `runProactiveHeal`'s output does not feed `GateDecision`; the check-run it
  posts is always `neutral`, so a slow preview, a missing `locate()` implementation, or a flaky
  preview environment can never turn a PASS into a BLOCK/WARN.
- **Confidence-gated suggestions.** Repairs below `minConfidence` are omitted from the draft PR and
  counted in the summary as "left for the reactive healer" rather than guessed at.
- **Bounded cost.** `maxLocatorsPerRun` caps how many locators are probed per run; anything skipped
  because of the cap is stated in the summary, not silently dropped.
- **Idempotent.** Re-running on the same PR updates the existing draft PR / check-run (same branch
  name), matching the coverage-sync publisher's behavior, instead of stacking duplicates.
- **Engine gap is explicit.** When the configured `browser.engine` has no `locate()` (v1: anything but
  Playwright), the run reports "proactive healing unsupported for engine `<name>`" in the check-run
  rather than silently checking zero locators and claiming a 100% heal rate.
- **Honest framing in the surfaced summary.** The check-run body includes a fixed one-line note that
  proactive healing is an optional posture, not a replacement for the reasoning healer, so a heal-rate
  number is never read as a quality score on its own.

## Testing

Fully hermetic, matching the rest of Warden — no live browser, network, or LLM in unit tests:

- `shouldRunProactiveHeal`: `fixtureChangeSurface` variants (empty vs non-empty
  `affectedComponents`, a module matching `uiPatterns`) × config `enabled` on/off → expected boolean.
- `LocatorExtractor`: a fake `FileAccess` serving fixture spec-file source (Playwright-style
  `getByRole`/`getByLabel` calls, some multi-line, some with dynamic `name`) → asserts the exact
  `LocatorRef[]` extracted, including line numbers, and that non-locator code is ignored.
- `LocatorResolver`: `fakeBrowserSession` extended with a scripted `locate()` (resolved / missing /
  ambiguous per call) → asserts `LocatorResolution[]` status/matchCount, and that a session with
  `locate` undefined yields an empty result with a stated skip reason.
- `LocatorRepairSuggester`: `fakeProvider` configured to return a `propose_locator` tool call → asserts
  the returned `ProactiveHealSuggestion.patch` is well-formed unified diff text and `confidence`
  reflects the tool call's field; a provider response with no tool call falls back to `confidence: 'low'`
  with no patch (never guesses a change without saying so).
- `summarizeHealRate`: table-driven — given fixed counts of resolved/missing/ambiguous/suggested,
  asserts `healRate` arithmetic, including the `checked === 0 → healRate === 1` edge case.
- `ProactiveHealPublisher`: recommendations + summary → asserted `openOrUpdateDraftPr` payload
  (branch name, file patches, `draft: true`) and `postCheckRun` payload (`conclusion: 'neutral'`
  always) against a mock `GitHubAccess`; a second call with the same `pr.number` asserts the same
  branch is reused (idempotency), not a second PR.
- `runProactiveHeal`: end-to-end with every collaborator faked (`FileAccess`, `fakeBrowserSession`,
  `fakeProvider`, mock `GitHubAccess`, a recording `MetricsEmitter`) — asserts the full pipeline order
  and that `emitHeal` is called once with `mode: 'proactive'` and the correct `HealRateSummary`.
- `format-heal-metrics.ts`: `HealRateSummary` fixture → asserted `PushedMetric[]` shape, mirroring
  `format-gate-metrics.test.ts`.
- `playwright-engine.ts`'s `locate()`: extended `PlaywrightPage` fake (adds `.count()` to
  `PlaywrightLocator`) → asserts `matchCount` is read from `getByRole`/`getByLabel` correctly for both
  `kind` values.
- Regression check: existing `HealerStrategy` tests are untouched and continue to pass unmodified,
  confirming the reactive path has zero behavior change.

## Rollout

1. Ship the additive core types/config and the `locate()`/`emitHeal()` optional interface extensions
   — no behavior change while `proactiveHealing.enabled` defaults to `false`.
2. Build `@warden/proactive-healer` and the Playwright `locate()` implementation; wire
   `shouldRunProactiveHeal` into the CLI/`@warden/github-action` PR pipeline, gated behind the config
   flag (opt-in, not part of any default tier).
3. Add `format-heal-metrics.ts` and a heal-rate panel to the dashboard next to the existing gate and
   flake panels, labeled clearly as "proactive (optional)" vs "reactive (default)".
4. Dogfood on this repo's own dashboard app: enable `proactiveHealing` against a preview deployment,
   confirm draft healing PRs are correct and low-noise before recommending it in docs.
5. Document the feature in `docs/` with the explicit honesty framing from §2.3: this is a posture
   option, not a claimed quality improvement over the reasoning healer.

## Risks & open items

- **Preview-environment availability.** The pass is only as useful as `previewUrlTemplate`; teams
  without a per-PR preview deployment get no value and should be told so plainly rather than
  discovering it via an always-neutral check.
- **False-positive repairs.** A locator that resolves to a _different_ element with the same role/name
  after a redesign could be "healed" incorrectly; keeping suggestions in a separate, human-reviewed
  draft PR (never auto-committed) is the primary mitigation, backed by the `minConfidence` filter.
- **No proven superiority.** As §2.3 states directly, continuous/proactive healing is not shown to
  outperform reactive, reasoning-based healing (0-of-3 in verification) — this feature closes an
  expectation gap with the market, and Warden's docs and dashboard labeling should not imply otherwise.
- **AI-driven engines unsupported in v1.** `claude-chrome`/`stagehand` have no natural `locate()`
  analog; proactive healing is effectively Playwright-only until that's revisited.
- **Cost.** Launching a browser session per eligible PR is not free; `maxLocatorsPerRun` and the
  opt-in default bound this, but teams enabling it broadly should budget for the extra preview-session
  time in CI.
