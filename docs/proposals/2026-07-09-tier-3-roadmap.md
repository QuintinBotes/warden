# Proposal: Tier-3 — Precision & Ecosystem

- **Status:** In progress — the **precision band (items 1–4) is shipped**; the ecosystem plays (5–6) remain · **Date:** 2026-07-09
- **Relates to:** [warden-next-competitive-gaps.md](2026-07-08-warden-next-competitive-gaps.md) §Tier-3, now that Tier-1 + Tier-2 have shipped.

Tier-3 is the "nice-to-have" band from the gap analysis: capabilities that sharpen precision and grow the ecosystem, but aren't table stakes. This doc scopes the six items. Each stays **additive to `@warden/core`, defaulted off, and hermetic**, and plugs into the two shared contracts (the CUJ rollup and the single gate + CTRF report).

## The six capabilities

| #   | Status     | Capability                                | Package / seam                                             |
| --- | ---------- | ----------------------------------------- | ---------------------------------------------------------- |
| 1   | ✅ shipped | Test impact analysis (this doc)           | `@warden/impact` + core seam + `warden run --impact-index` |
| 2   | ✅ shipped | Component / Storybook testing             | `component` tier in `@warden/runner`                       |
| 3   | ✅ shipped | Load testing as a first-class tier        | `load` tier in `@warden/runner` (k6 VUs + thresholds)      |
| 4   | ✅ shipped | i18n content checks                       | `i18n` check in `@warden/runner` (missing/empty keys)      |
| 5   | ⬜ planned | Hosted results service / public run links | a small service over `dashboard-api` + share tokens        |
| 6   | ⬜ planned | Plugin marketplace / registry             | a manifest + discovery layer over `QAPlatformPlugin`       |

The precision band (1–4) landed as runner tiers + core seams, each mirroring the k6/ZAP converter → gate → integration-fn shape. Items 5 and 6 are ecosystem/hosted plays that imply a hosted tier (see the enterprise proposal's hosted-vs-OSS note); they should follow.

---

## 1. Test Impact Analysis (first to build)

### Summary

Today Warden selects tiers by changed **module/tag** + a risk score — coarse. Test Impact Analysis (TIA) makes selection **precise**: given a coverage index that maps each test to the source files it exercised on a prior run, a PR runs exactly the tests whose covered files intersect the diff — plus a safety net for new/uncovered files. This is how large monorepos keep CI minutes bounded, and few OSS tools offer it.

### Motivation

- Currents.dev / Nx / Bazel-style affected-test selection is the state of the art for CI cost control; Warden's module-tag selection is a coarse approximation.
- Warden already computes a `ChangeSurface` (changed files) and stores executions — it just lacks the per-test → per-file coverage link.

### Goals / Non-Goals

- **Goal:** given a diff + a coverage index, return the impacted test ids (and a reason per test), with an explicit fallback set for changed files no test covers.
- **Goal:** feed the impacted set into tier selection so `warden run` can narrow `--grep` to the affected tests.
- **Non-Goal:** collecting coverage itself (that's a runner concern — v1 ingests an istanbul/v8-style JSON index a normal coverage run already produces).
- **Non-Goal:** dropping the risk-based full-suite escalation — TIA narrows the _default_ run; a high-risk change still escalates.

### Architecture (additive)

- **`@warden/core`** — a new `impact.ts` module: `CoverageIndex` (`{ testId, testName, files: string[] }[]`), `ImpactResult` (`{ impacted: {testId, reason}[]; uncoveredChangedFiles: string[]; safetyNet: boolean }`), and an `impact` config block (`enabled`, `indexPath`, `onUncovered: 'run-all' | 'run-tagged' | 'warn'`). Exported from `index.ts`.
- **`@warden/impact`** — pure units:
  - `loadCoverageIndex(json): CoverageIndex` — validate + normalize an istanbul/v8 coverage report (or Warden's own index) into the `CoverageIndex` shape, over injected file access.
  - `computeImpact(changeSurface, index, cfg): ImpactResult` — intersect changed files with each test's covered files; collect changed files no test covers into `uncoveredChangedFiles`; set `safetyNet` per `onUncovered`.
  - `impactToGrep(result): string` — render the impacted test ids/names into a Playwright `--grep` (or a title filter) the runner understands.
- **`@warden/orchestrator`** — additive: `selectTiersWithImpact(changeSurface, cfg, index?)` that, when `cfg.impact.enabled` and an index is present, narrows the selected tier's filter to the impacted set (falling back to the existing tier selection when uncovered/absent).

### Data flow

1. A normal Warden run (or a CI coverage job) emits a per-test coverage report to `cfg.impact.indexPath`.
2. On a PR, the orchestrator loads the index, calls `computeImpact(changeSurface, index, cfg)`.
3. Impacted tests → a narrowed `--grep`; `uncoveredChangedFiles` trigger the `onUncovered` policy (run all / run tagged / warn) so a brand-new file is never silently skipped.
4. `warden run` runs the narrowed set; everything downstream (CTRF, gate, CUJ) is unchanged.

### Testing (hermetic)

Inject the file access + a fixture coverage index. Assert: a diff touching a covered file selects exactly its tests; an uncovered changed file trips the `safetyNet` per policy; `impactToGrep` renders a valid filter; an empty diff selects nothing.

### Rollout

Ship `@warden/impact` + the core seam first (pure, testable), then the orchestrator selection wiring, then a `warden run --impact-index <path>` flag. Default off; enabling it narrows the default run while risk-escalation still forces the full suite.

## Risks & open items

- **Index freshness:** a stale index under-selects. Mitigate with the `onUncovered` safety net + a max-age warning.
- **Coverage granularity:** file-level is the v1; statement-level is a later refinement.
- **Provider of the index:** v1 ingests standard coverage JSON; a Warden-native collector (instrument the tier run) is a follow-up.
