# Proposal: Visual Regression Testing

- **Status:** Draft (design proposal) · **Date:** 2026-07-08 · **Relates to:** [warden-next-competitive-gaps.md §1.1](./2026-07-08-warden-next-competitive-gaps.md)

## Summary

Warden asserts _behavior_ today; it has no eyes for _appearance_. This proposal adds a new
`@warden/visual` package and a `VisualEngine` seam that captures deterministic baseline
screenshots — one per module × viewport × theme — using the browser engines Warden already drives,
compares each new render against a Git-versioned baseline, and surfaces the delta as a first-class
`VISUAL_DIFF` result that feeds the merge gate, the PR comment, and the dashboard replay. On top of
the deterministic pixel floor, an **optional AI structure-aware diff** lets the configured
`LLMProvider` judge whether a pixel change is a _meaningful_ regression or mere _render-noise_ —
mirroring the differentiator that makes visual-AI incumbents usable at scale — and an
**approve-baseline** action lets a human bless an intentional change so the next run is green.

## Motivation

A large class of real, ship-blocking bugs is purely visual: a layout that breaks at a breakpoint, an
overflow that clips a CTA, a z-index war that hides a modal, a contrast regression that fails
accessibility. None of these trip a functional assertion — the button is still clickable, the API
still returns 200 — so they sail through Warden's current tiers and land in production. "Do you have
visual regression?" is one of the first questions a QA lead asks when evaluating a platform, and
today Warden's honest answer is no.

Every serious competitor ships this (gap analysis §1.1): **Applitools** built its business on
"Visual AI" (a model that judges _structure_ to suppress false positives) plus its Ultrafast Grid;
**Percy** does DOM-snapshotting on real browsers; **Chromatic** does it for Storybook;
**Playwright**'s native `toHaveScreenshot()` is the free OSS starting point most teams reach for
first; **BackstopJS**, **mabl**, and **Testim** round out the field. The recurring pain with the
naive pixel-only approach is _noise_: anti-aliasing, sub-pixel font rendering, and animated content
produce diffs on every run, teams stop trusting the tool, and they mute it. Applitools' key advantage
is precisely that it doesn't drown you in noise. Warden can match the table-stakes capability with
Playwright screenshots **and** match the differentiator by letting its existing provider seam do the
"meaningful vs. noise" judgment — while staying open-source and self-hostable, which none of the
above are.

## Goals

1. Capture **deterministic** baseline screenshots per `module × viewport × theme`, driven through
   the browser engine already selected in `browser.engine`.
2. Store baselines **versioned in Git** alongside the code, with a plain-file layout and a manifest —
   no external service required.
3. Detect changes with a deterministic **pixel floor**, and offer an **optional AI structure-aware
   mode** where the `LLMProvider` classifies each diff as `meaningful` or `render-noise` to cut false
   positives.
4. Surface every comparison as a first-class **`VISUAL_DIFF`** visual status that maps into CTRF, so
   it **feeds the merge gate** (BLOCK / WARN / PASS) and renders in the **PR comment** and
   **dashboard replay** with a baseline / candidate / diff triptych.
5. Provide an **approve-baseline** action (CLI, PR comment command, dashboard button) so an
   intentional visual change promotes the candidate to the new baseline and commits it.
6. Be **additive** to `@warden/core`, fully hermetic, and off by default (zero cost when disabled).

## Non-Goals

- A hosted rendering grid across hundreds of browser/OS combinations (that is the cross-browser grid
  gap §1.2; visual runs on whatever single engine `browser.engine` selects).
- Component-level / Storybook visual testing (Tier 3 in the gap analysis); this proposal is
  route/module-level. The `VisualEngine` seam is shaped so a component harness can implement it later.
- Replacing functional assertions. Visual diffing is an additional signal into the same gate, not a
  substitute for behavioral tests.
- Training or shipping a bespoke vision model. The AI mode reuses the configured provider's vision
  capability; when the provider has none, Warden runs in deterministic pixel mode.

## Architecture

One new package plus small, additive extensions to three existing ones. Every external collaborator
(browser engine, provider, baseline store) is **injected**, so the whole engine is unit-testable
without a live browser, network, or LLM.

### New — `@warden/visual`

The visual-regression engine, built as small single-purpose units. No I/O of its own beyond the
injected collaborators; it consumes a `BrowserEngine` (to render), a `VisualBaselineStore` (to read
Git baselines), and — in AI mode — an `LLMProvider` (to judge). It emits a `CTRFReport` (tool
`warden-visual`) plus `VisualFinding[]`, both of which flow into Warden's existing gate, reporter, and
dashboard exactly like any other tier.

### Extended (additive, no breaking changes)

- **`@warden/core`** — a new `visual.ts` module (the types + seams below), exported from
  `index.ts` next to `coverage-sync.ts`; one additive **optional** method on `LLMProvider` for vision
  input; and an additive `visual` block on `WardenConfigSchema`. Nothing in V1 changes.
- **`@warden/reporter`** — `RenderPrReportExtras` gains an optional `visualFindings?` field and the
  PR report gains a **Visual Regression** section; a `visual-comment-reporter.ts` renders the
  triptych links. The gate itself is unchanged — visual results reach it as CTRF.
- **`@warden/cli`** — a `warden visual approve <module> [--viewport --theme]` subcommand wired to
  `@warden/visual`'s `approveBaseline`.

### The new seams (in `@warden/core/src/visual.ts`)

```ts
import type { BrowserEngine } from './browser';
import type { LLMProvider } from './llm';
import type { ChangeSurface } from './change-surface';
import type { WardenConfig } from './config';

/** One point in the capture matrix: what to render, at which viewport and theme. */
export interface VisualCheck {
  module: string; // e.g. 'apps/checkout'
  url: string; // preview URL for that module's route
  viewport: { name: string; width: number; height: number };
  theme: 'light' | 'dark';
  /** CSS selectors whose regions are masked (dynamic content: clocks, avatars, ads). */
  mask?: string[];
}

/** A captured render: raw PNG bytes plus geometry. Bytes stay in-memory so tests need no fs. */
export interface VisualShot {
  check: VisualCheck;
  png: Uint8Array;
  width: number;
  height: number;
}

/**
 * Deterministic screenshot seam (sibling to `BrowserEngine`). The Playwright-backed
 * implementation disables animations, quiesces fonts/network, applies the color-scheme +
 * viewport, masks dynamic regions, then screenshots — so re-running the same commit is stable.
 */
export interface VisualEngine {
  name: string; // 'playwright-visual'
  capture(check: VisualCheck): Promise<VisualShot>;
  close(): Promise<void>;
}

/** Git-versioned baseline storage. Backed by files under `visual.baselinesDir` + a manifest. */
export interface VisualBaselineKey {
  module: string;
  viewport: string;
  theme: 'light' | 'dark';
}
export interface VisualBaseline {
  key: VisualBaselineKey;
  path: string; // repo-relative PNG path
  width: number;
  height: number;
  sourceSha: string; // commit the baseline was captured from
  approvedBy?: string; // who blessed it (audit trail)
  approvedAt?: string; // ISO timestamp
}
export interface VisualBaselineStore {
  get(key: VisualBaselineKey): Promise<VisualBaseline | null>;
  read(baseline: VisualBaseline): Promise<Uint8Array>;
  /** Write a candidate as a *pending* baseline (uncommitted) for a new or changed check. */
  putPending(key: VisualBaselineKey, shot: VisualShot, sourceSha: string): Promise<VisualBaseline>;
  /** Promote a pending/candidate to the committed baseline; records `approvedBy`. */
  approve(key: VisualBaselineKey, approvedBy: string): Promise<VisualBaseline>;
  list(module?: string): Promise<VisualBaseline[]>;
}

/** Deterministic pixel comparison — a pure function; the noise floor under the AI judge. */
export interface PixelDiffResult {
  changedRatio: number; // 0..1 of pixels beyond the anti-alias tolerance
  diffPng: Uint8Array; // highlighted diff image, for the triptych
  boundingBoxes: { x: number; y: number; w: number; h: number }[]; // clustered change regions
}

/** The structure-aware judgment (AI mode). Classifies a *pixel-confirmed* change. */
export interface VisualJudgment {
  classification: 'meaningful' | 'render-noise';
  confidence: number; // 0..1
  rationale: string; // one line surfaced to the reviewer
}
export interface VisualJudge {
  judge(input: {
    check: VisualCheck;
    baseline: Uint8Array;
    candidate: Uint8Array;
    pixel: PixelDiffResult;
  }): Promise<VisualJudgment>;
}

/** Per-check outcome. `VISUAL_DIFF` is the new visual status role that feeds the gate. */
export type VisualStatus = 'MATCH' | 'VISUAL_DIFF' | 'NEW_BASELINE';
export interface VisualComparison {
  check: VisualCheck;
  status: VisualStatus;
  changedRatio: number;
  judgment?: VisualJudgment; // present only in AI mode when pixels changed
  baselinePath?: string;
  candidatePath: string; // written under artifactsDir for replay
  diffPath?: string;
}

/** A visual regression surfaced in the PR comment + dashboard (sibling to `ExploratoryFinding`). */
export interface VisualFinding {
  module: string;
  viewport: string;
  theme: 'light' | 'dark';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  changedRatio: number;
  rationale?: string; // from the judge in AI mode
  baselinePath?: string;
  candidatePath: string;
  diffPath?: string;
}

/** Plans the capture matrix from the change surface + config (only touched modules). */
export type PlanVisualChecks = (
  changeSurface: ChangeSurface,
  cfg: WardenConfig,
  resolveUrl: (module: string) => string,
) => VisualCheck[];

/** Factory: wrap the already-selected `BrowserEngine` in a deterministic `VisualEngine`. */
export type VisualEngineFactory = (
  engine: BrowserEngine,
  visual: WardenConfig['visual'],
) => VisualEngine;
```

### Additive vision method on `LLMProvider` (in `@warden/core/src/llm.ts`)

The AI judge needs image input; the V1 provider interface is text-only. We add **one optional**
method, exactly as `streamText?` is optional — V1 providers stay valid, and the visual pipeline
degrades to pixel mode when a provider omits it:

```ts
export interface ImagePart {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  dataBase64: string;
}

export interface LLMProvider {
  name: string;
  generateText(prompt: string, options?: GenerateOptions): Promise<string>;
  generateWithTools(
    prompt: string,
    tools: Tool[],
    options?: GenerateOptions,
  ): Promise<ToolCallResult>;
  streamText?(prompt: string): AsyncIterable<string>;
  /** V-visual: multimodal generation. Optional — providers without vision omit it. */
  generateWithImages?(
    prompt: string,
    images: ImagePart[],
    options?: GenerateOptions,
  ): Promise<string>;
}
```

`ProviderVisualJudge` wraps whatever provider `ai.provider` resolves to: it sends the baseline,
candidate, and pixel-diff regions with a tight rubric and reads back a `{ classification, confidence,
rationale }` JSON at `temperature: 0`. If `generateWithImages` is undefined, the judge is never
constructed and the run falls back to the pixel floor.

## Configuration

Additive `visual` block on `WardenConfigSchema`, following the V2 opt-in convention (every key has a
default; disabled by default so existing configs are untouched):

```ts
visual: {
  enabled:          false,                 // opt-in, like the other V2 features
  mode:             'pixel',               // 'pixel' | 'ai' (ai = structure-aware judge over pixels)
  baselinesDir:     'tests/visual/baselines/',
  viewports: [                             // defaults mirror browser.viewport / mobileViewport
    { name: 'desktop', width: 1280, height: 720 },
    { name: 'mobile',  width: 375,  height: 667 },
  ],
  themes:           ['light'],             // ['light', 'dark']
  noiseThreshold:   0.001,                 // pixel changedRatio below this ⇒ MATCH
  antiAliasTolerance: 0.1,                 // pixelmatch tolerance for sub-pixel AA
  gate:             'warn',                // 'block' | 'warn' | 'off' — severity of a VISUAL_DIFF
  onNewBaseline:    'neutral',             // 'neutral' | 'block' — how a first-seen check is treated
  mask:             [],                    // global CSS selectors to mask (per-check mask adds to this)
  maxChecks:        200,                   // matrix cap; overflow is skipped and reported
}
```

Types (additive):

```ts
visual: z
  .object({
    enabled: z.boolean().default(false),
    mode: z.enum(['pixel', 'ai']).default('pixel'),
    baselinesDir: z.string().default('tests/visual/baselines/'),
    viewports: z
      .array(z.object({ name: z.string(), width: z.number(), height: z.number() }))
      .default([
        { name: 'desktop', width: 1280, height: 720 },
        { name: 'mobile', width: 375, height: 667 },
      ]),
    themes: z.array(z.enum(['light', 'dark'])).default(['light']),
    noiseThreshold: z.number().default(0.001),
    antiAliasTolerance: z.number().default(0.1),
    gate: z.enum(['block', 'warn', 'off']).default('warn'),
    onNewBaseline: z.enum(['neutral', 'block']).default('neutral'),
    mask: z.array(z.string()).default([]),
    maxChecks: z.number().default(200),
  })
  .default({}),
```

## Data flow

1. A PR opens; the **orchestrator** computes the `ChangeSurface` (changed modules, affected
   components/routes, risk) as it does for every tier.
2. `planVisualChecks(changeSurface, cfg, resolveUrl)` expands the **touched** modules into the
   `module × viewport × theme` matrix (capped at `visual.maxChecks`), yielding `VisualCheck[]`. If
   `visual.enabled` is false or the matrix is empty, the pipeline no-ops.
3. `createVisualEngine(engine, cfg.visual)` wraps the engine chosen by `browser.engine` in a
   deterministic `VisualEngine`. For each check: apply theme (`emulateMedia`) + viewport, quiesce
   (fonts loaded, network idle, animations disabled), mask dynamic regions, then `capture` → a
   `VisualShot` (PNG bytes).
4. `VisualBaselineStore.get(key)` loads the committed baseline from `visual.baselinesDir`.
   - **No baseline** → `NEW_BASELINE`: write the candidate via `putPending`, surface per
     `visual.onNewBaseline` (neutral by default — first sight never surprises a block).
5. `pixelDiff(baseline, candidate, cfg)` computes `changedRatio` + a highlighted diff PNG +
   change regions.
   - `changedRatio ≤ noiseThreshold` → `MATCH`.
6. In **AI mode** (`mode: 'ai'` and the provider implements `generateWithImages`), the pixel-confirmed
   change goes to `ProviderVisualJudge.judge`:
   - `render-noise` → downgraded to `MATCH` (suppressed; logged with the rationale).
   - `meaningful` → `VISUAL_DIFF`. In **pixel mode**, any `changedRatio > noiseThreshold` is
     `VISUAL_DIFF` directly.
7. Each `VisualComparison` becomes (a) a **CTRF test** in a `warden-visual` report — `MATCH`/
   `NEW_BASELINE` → `passed`, `VISUAL_DIFF` → `failed` when `gate: 'block'` else recorded as a
   warn-tagged `other` — with baseline/candidate/diff paths in `extra` for replay; and (b) a
   `VisualFinding` for the PR comment.
8. The `warden-visual` CTRF is **merged** into the run's other tier reports (`MergeCtrf`), so the
   existing **merge gate** consumes it and returns BLOCK / WARN / PASS with no gate changes.
9. The **reporter** renders a **Visual Regression** section in the PR comment (per-check status +
   triptych links) and the check-run; the **dashboard** replays the baseline / candidate / diff
   triptych straight off the CTRF `extra` media paths (no new dashboard interface).
10. A reviewer approves an intentional change — `warden visual approve <module>`, a PR
    `/warden approve-visual` comment, or the dashboard button → `approveBaseline` promotes the
    candidate to the committed baseline (records `approvedBy` + `sourceSha`) and commits it. The next
    run is `MATCH`.
11. `MetricsEmitter.emitExecution` carries the visual results (they are part of the merged execution);
    a `warden_visual_diffs` gauge is emitted alongside the existing metrics.

## Units & files

New package `@warden/visual` (`packages/visual/src/`), each unit small and single-purpose:

| File                          | Responsibility                                                                                                                                               | Deps                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `index.ts`                    | Barrel: re-exports the engine factory, store, pipeline, and converters.                                                                                      | —                                  |
| `plan-checks.ts`              | `planVisualChecks` — change surface + config → `VisualCheck[]` (touched modules × viewport × theme, capped).                                                 | core                               |
| `playwright-visual-engine.ts` | `PlaywrightVisualEngine implements VisualEngine` — deterministic capture (emulate media, disable animations, mask, quiesce, screenshot).                     | core, playwright                   |
| `create-visual-engine.ts`     | `createVisualEngine(engine, cfg.visual)` — wraps the selected `BrowserEngine`; injectable for tests.                                                         | core                               |
| `pixel-diff.ts`               | `pixelDiff(a, b, cfg)` — pure `PixelDiffResult` (pixelmatch + pngjs), regions clustered.                                                                     | pixelmatch, pngjs                  |
| `git-baseline-store.ts`       | `GitBaselineStore implements VisualBaselineStore` — read/write PNG + `baselines.json` manifest under `baselinesDir`; `approve` stamps + stages.              | core, injected fs/git              |
| `provider-visual-judge.ts`    | `ProviderVisualJudge implements VisualJudge` — builds the rubric prompt, calls `provider.generateWithImages`, parses the JSON verdict.                       | core (LLMProvider)                 |
| `compare.ts`                  | `compareCheck` — one check: capture → load baseline → pixel-diff → (ai) judge → `VisualComparison`.                                                          | core                               |
| `to-ctrf.ts`                  | `visualToCtrf(comparisons, cfg)` — `VisualComparison[]` → `CTRFReport` (tool `warden-visual`), media in `extra`.                                             | core (CTRF)                        |
| `to-findings.ts`              | `visualToFindings(comparisons)` — `VisualComparison[]` → `VisualFinding[]` with severity from `changedRatio`.                                                | core                               |
| `approve.ts`                  | `approveBaseline(key, approvedBy, store, gh?)` — promote candidate → baseline locally, optionally commit via injected `GitHubAccess`.                        | core, coverage-sync `GitHubAccess` |
| `run.ts`                      | `runVisualChecks(input)` — the pipeline wiring (plan → capture → compare → convert), every collaborator injected; returns `{ comparisons, ctrf, findings }`. | all of the above                   |
| `testing-fakes.ts`            | `fakeVisualEngine`, `fakeBaselineStore`, `fixtureShot`, `fixtureCheck` — owned fakes so the package tests hermetically.                                      | core                               |

Additive edits to existing packages:

| File                                               | Responsibility                                                                                                     | Deps           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------- |
| `packages/core/src/visual.ts`                      | All visual types + `VisualEngine` / `VisualJudge` / `VisualBaselineStore` seams (above); exported from `index.ts`. | core           |
| `packages/core/src/llm.ts`                         | Add optional `generateWithImages?` + `ImagePart` (additive).                                                       | core           |
| `packages/core/src/config.ts`                      | Add the `visual` block to `WardenConfigSchema` (additive, defaulted).                                              | zod            |
| `packages/reporter/src/pr-report.ts`               | `RenderPrReportExtras.visualFindings?` + a Visual Regression section.                                              | core           |
| `packages/reporter/src/visual-comment-reporter.ts` | Render the per-check status table + triptych links.                                                                | core           |
| `packages/cli/src/…`                               | `warden visual approve` subcommand → `approveBaseline`.                                                            | @warden/visual |

## Safety & error handling

- **Opt-in, zero cost when off.** `visual.enabled` defaults to false; when false, `runVisualChecks`
  returns an empty result before touching the browser.
- **First sight never surprises a block.** A check with no committed baseline is `NEW_BASELINE`,
  neutral by default (`onNewBaseline`); the candidate is written as a _pending_ baseline for review,
  never silently promoted.
- **Baselines are proposed, never auto-approved.** Promotion happens only through an explicit
  `approveBaseline` (CLI / PR command / dashboard), which records `approvedBy` + `sourceSha` for an
  audit trail. A drifted baseline shows up as a reviewable Git diff.
- **Graceful AI degradation.** If `mode: 'ai'` but the provider lacks `generateWithImages`, or the
  judge call errors/times out, the check falls back to the deterministic pixel verdict and logs the
  reason — the run never crashes on a provider gap.
- **Determinism first.** Animations disabled, fonts/network quiesced, dynamic regions masked, and a
  configurable `antiAliasTolerance` — the pixel floor is the ground truth; the AI only ever
  _suppresses_ a pixel-confirmed change, never invents one.
- **Flaky-visual reuse.** A check that oscillates MATCH↔VISUAL_DIFF across retries maps to a `FLAKY`
  CTRF result and rides the existing `flakeQuarantineAfterRuns` quarantine path — no separate
  mechanism.
- **Bounded.** The matrix is capped at `visual.maxChecks`; overflow is skipped and stated in the
  summary (no silent truncation). Images are downscaled before the vision call to bound tokens.
- **Cross-render caveat handled explicitly.** Font/AA rendering differs across OS/browser images;
  the baseline key can be namespaced per runner image, and the default advice is to capture and
  compare on the same CI image (see Risks).

## Testing

Fully hermetic, matching the rest of Warden — every collaborator is a fake the package owns; no live
browser, network, or LLM in unit tests:

- **`plan-checks`** — `fixtureChangeSurface` + config → asserted `VisualCheck[]` (only touched
  modules; viewport × theme expansion; `maxChecks` cap respected).
- **`pixel-diff`** — a pure function tested with tiny in-repo PNG fixtures: identical → `changedRatio
0`; a known N-pixel patch → the expected ratio and bounding box; AA-only noise under tolerance →
  `0`.
- **`compare`** — with `fakeVisualEngine` (canned `VisualShot`) and `fakeBaselineStore` (in-memory):
  identical shot ⇒ `MATCH`; empty store ⇒ `NEW_BASELINE` (+ `putPending` called); changed shot in
  pixel mode ⇒ `VISUAL_DIFF`.
- **`provider-visual-judge`** — `fakeProvider` with a `generateWithImages` stub returning
  `render-noise` ⇒ compare downgrades to `MATCH`; returning `meaningful` ⇒ `VISUAL_DIFF`; a provider
  _without_ `generateWithImages` ⇒ judge is skipped and the pixel verdict stands.
- **`to-ctrf` / `to-findings`** — `VISUAL_DIFF` → CTRF `failed` (under `gate: 'block'`) with
  baseline/candidate/diff in `extra`; `MATCH` → `passed`; finding severity derived from
  `changedRatio`.
- **`approve`** — `approveBaseline` promotes the pending candidate, sets `approvedBy` + `sourceSha`,
  and (with a fake `GitHubAccess`) asserts the expected commit payload; a re-run then reports `MATCH`.
- **`run`** — the full pipeline with all fakes injected → asserted `{ comparisons, ctrf, findings }`;
  and a gate assertion: a `meaningful` diff under `gate: 'block'` yields `computeGateDecision → BLOCK`,
  under `gate: 'warn'` yields `WARN`.
- **`reporter`** — `renderPrReport(execution, gate, { visualFindings })` renders the Visual
  Regression section with the triptych links; escaping is asserted.

## Rollout

1. **Pixel core (hermetic, no AI).** Ship `@warden/core` visual types + config block, and
   `@warden/visual` with `PlaywrightVisualEngine`, `GitBaselineStore`, `pixel-diff`, `to-ctrf` /
   `to-findings`, and the PR-comment section. Baselines in Git; `VISUAL_DIFF` feeds the gate. This
   alone matches the Playwright-`toHaveScreenshot` / BackstopJS baseline.
2. **AI structure-aware mode.** Add the `generateWithImages` provider method (Claude default, then the
   other providers that support vision), `ProviderVisualJudge`, and `mode: 'ai'` — the noise-cutting
   differentiator over pure-pixel tools.
3. **Approve-baseline surfaces.** Wire the `warden visual approve` CLI, the `/warden approve-visual`
   PR command, and the dashboard triptych + approve button.
4. **Docs + metrics.** Document `visual.*` in `docs/configuration.md`, add the baseline-workflow
   guide, and emit the `warden_visual_diffs` gauge through the existing `MetricsEmitter`.

## Risks & open items

- **Cross-platform pixel nondeterminism.** Sub-pixel font/AA rendering differs across OS and browser
  builds, the classic source of visual-test flake. Mitigations: `antiAliasTolerance`, mask dynamic
  regions, and namespace baselines per runner image; the default guidance is same-image capture and
  compare. A future per-OS baseline key is an open item.
- **Baseline binary bloat in Git.** Baseline PNGs accumulate in-repo. First version keeps resolution
  modest and viewports few; Git LFS support and a retention/prune policy are open items.
- **Judge cost, latency, and determinism.** The vision call adds tokens and time per changed check.
  Mitigations: `mode: 'ai'` is opt-in, only pixel-confirmed changes are judged, `temperature: 0`, and
  verdicts are cached by the pixel-diff hash. Whether to cap AI judging to high-risk modules only is
  an open tuning decision.
- **Judge false negatives.** A structure-aware judge could suppress a genuine regression as noise.
  The pixel floor is retained as ground truth and the AI can only suppress, never fabricate; a
  `confidence` threshold below which the pixel verdict wins is an open knob.
- **Preview URL resolution.** Visual checks need a live preview URL per module (`resolveUrl`); the
  first version relies on the same preview-environment convention the exploratory tier already uses.
  Static/SSG routes and auth-gated pages are follow-ups.
- **Scope vs. the grid (§1.2).** Rendering across many browser/resolution combos (Applitools'
  Ultrafast Grid) is explicitly out of scope here and belongs to the cross-browser grid work; the
  `VisualEngine` seam is designed so a grid provider can back it later.
