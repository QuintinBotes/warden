# Changelog

All notable changes to Warden are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Gate hardening — "nothing ran/passed" never reads as a green gate.** A parallel audit of the
  gate-decision logic surfaced a class of empty/degenerate inputs that returned a false `PASS`.
  All now WARN honestly (WARN-direction only, so no currently-passing merge is newly blocked):
  - `computeGateDecision` → `WARN "no tests passed"` when tests ran but every result was skipped
    or blocked (previously `PASS "All tests passed"` — a blocked test started but never finished).
  - `evaluateExitCriteria([])` → `WARN "no tests ran"` (the pass-rate math previously manufactured
    100% for an empty 0/0 set).
  - `combineGateDecisions([])` and the CUJ `mergeGateDecisions()` → `WARN`, not a vacuous `PASS`,
    when given no decisions to combine.
  - The CUJ gate `WARN`s a touched journey whose tests didn't run this change (`NOT_TESTED`)
    instead of reporting it "healthy" against a DEGRADED/BROKEN baseline.
- **The GitHub Action now fails _closed_.** A crashed/absent `warden report aggregate` step, or an
  aggregate report with a missing/unrecognized gate decision, previously defaulted the merge check
  to `PASS` — a broken gate could post a green check and unblock a merge. Both now resolve to
  `BLOCK`; only an explicit, recognized `PASS`/`WARN`/`BLOCK` is trusted.

## [0.4.0] — 2026-07-10 · "Dogfood"

Driven by dogfooding `warden run` against Warden's own repo (and an adversarial verification
pass on the results): a batch of real fixes the hermetic tests never exercised, plus a local
loop that lets you **see your own run in the Sentinel dashboard**.

### Fixed

- **A local `warden run` no longer crashes** outside GitHub Actions. When no GitHub client
  is available the PR-comment and check-run reporters are skipped with a warning instead of
  throwing, and the job summary falls back to `<artifacts-dir>/job-summary.md`. The CI path
  (where the Action supplies an octokit) is unchanged.
- **CTRF reports keep human-readable test names.** The CTRF→execution→CTRF round-trip was
  replacing each test's title with its opaque `testCaseId` hash (`TC-ef7a…`); reports now
  carry the real title (e.g. `checkout › apply discount code`) and `filePath`, so the
  dashboard, PR comment, and job summary are legible. `testCaseId` remains the stable
  identity for flake/quarantine history.
- **The PR comment / job-summary coverage table** now shows the human-readable test name
  instead of the `testCaseId` hash — the last surface that still leaked hashes.
- **The gate no longer reports a false green when zero tests ran.** `computeGateDecision`
  previously emitted `PASS — "All tests passed"` for an empty (or silently unparseable)
  report; it now returns `WARN — "no tests ran"`, surfacing the anomaly without hard-blocking
  legitimate no-test changes.

### Added

- `TestResult` gains optional `name` and `filePath` fields (additive; consumers fall back to
  `testCaseId` when absent).
- **`warden run --db <path>`** persists a run into a SQLite store, so flake history builds up
  across runs and the dashboard can render real results. Off by default — no store is written
  unless `--db` is given.
- **See a real run in the dashboard locally.** `snapshot.mjs` accepts `WARDEN_STORE=<path>` to
  build the dashboard snapshot from a real store (instead of the demo seed), and prefers each
  result's real name. Panels a single run can't populate (Coverage Sync, CUJ, Visual
  Regression, Flake Intelligence, Learning) now render honest empty states for a real snapshot.
- **`examples/dashboard-selftest/`** — a dogfood example that runs Warden's `@smoke` tier
  against its own dashboard over http, persists the run, and rebuilds the dashboard from it, so
  you can open the Sentinel UI locally and see your own results.

## [0.3.0] — 2026-07-09 · "Tier-3 & Hardening"

Completes the **Tier-3 roadmap** (all six items), packages the GitHub Action for real
distribution, brings every dependency to its latest major, and hardens the codebase against
its own security scanning. Everything new is additive, defaulted off, and hermetically tested.

### Added — Tier-3 (precision)

- **Test impact analysis** (`@warden/impact`) — a coverage index maps each test to the files it
  exercised; `warden run --impact-index <path>` narrows the run to exactly the tests a diff impacts,
  with a safety net for uncovered files. Risk escalation still forces the full suite.
- **Component / Storybook testing** — a `component` tier in `@warden/runner` (Playwright CT or the
  Storybook test-runner) → CTRF + gate.
- **Load testing** — a first-class `load` tier (k6 VUs/duration + p95/p99/error-rate thresholds).
- **i18n content checks** — a pure `i18n` check for missing/empty translation keys across locales.

### Added — Tier-3 (ecosystem)

- **Hosted results service** (`@warden/results-service`) — mints HMAC-signed, expiring **share tokens**
  granting read-only access to one run's (redacted) results via a public link; opt-in, self-hostable,
  secrets from env.
- **Plugin registry** (`@warden/plugin-registry`) — a manifest schema + a searchable registry
  (by text/capability/tag) + a dynamic resolver that turns a manifest into a `QAPlatformPlugin`.

### Added — integration & UX

- The **accessibility + performance-budget tiers are wired into `warden run`** (`--base-url` / `--base`
  / `--head`) and into the **GitHub Action** (new `base-url` input) alongside the **CUJ-scoped gate**.
- Dashboard panels for **Critical User Journeys**, **Visual Regression**, and **Flake Intelligence**.

### Changed — packaging & CI

- The **GitHub Action is now distributable**: its bundle is inlined and committed, guarded by a CI
  freshness check — `uses: QuintinBotes/warden/packages/github-action@v0.3.0` works.
- **Dependabot** version updates + **CodeQL** code scanning are enabled and running clean.
- **Dependency modernization** — brought to latest major: React 19, Next 16, Vitest 4, jsdom 29,
  `@types/node` 26, better-sqlite3 12, lighthouse 13, jose 6, commander 15, js-yaml 5, c12 3,
  pixelmatch 7, `@actions/core` 3, and the `@octokit/*` majors. (TypeScript is deliberately held at 5.6
  until tsup/rollup-plugin-dts support TS 7's native compiler.)

### Security

- **Resolved every CodeQL alert** (0 open): backtracking regexes replaced with linear
  `@warden/core` helpers (`stripTrailingSlashes`, `slugify`) or safe rewrites; the markdown
  `escapeCell` and route-wildcard substitution hardened against incomplete sanitization.
- Pinned the `undici` override to the 7.x line (still above the 6.27.0 GHSA floor) so jsdom 29 loads.

### Notes

- Package count 25 → **28**; the test suite ~1,180 → **1,315**. All new capabilities remain opt-in.

## [0.2.0] — 2026-07-09 · "Warden Next"

The competitive-gap roadmap, shipped. Thirteen new capabilities, all **additive to
`@warden/core`, defaulted off, independently shippable, and hermetically tested**. They
compose into one PR pipeline with Critical User Journeys as the organizing layer and a single
`BLOCK`/`WARN`/`PASS` gate + CTRF report as the shared contracts (see
[`docs/proposals/2026-07-08-warden-next-integrated-flow.md`](docs/proposals/2026-07-08-warden-next-integrated-flow.md)).

### Added — Tier 1 (credibility & scale)

- **Visual regression** (`@warden/visual`) — deterministic screenshot capture + `pixelmatch` diffing,
  Git-versioned baselines, and an optional AI structure-aware judge (via `LLMProvider.generateWithImages`)
  that suppresses render-noise. Emits CTRF + a `VISUAL_DIFF` status into the gate; `warden visual approve`.
- **Notifications** (`@warden/notifications`) — first-party Slack / Teams / PagerDuty / webhook plugins,
  plus the orchestrator `firePluginHooks` dispatcher (a bad webhook can never fail the run or block the gate).
- **Accessibility & performance budgets** — axe-core + Lighthouse tiers in `@warden/runner` (pure
  converters + gate evaluators, mirroring k6/ZAP), a changed-route resolver, and `combineGateDecisions`.
  Wired into `warden run` via `--base-url`/`--base`/`--head`.
- **Flaky-test intelligence** — configurable retry policy, an LLM root-cause classifier, quantified
  `FlakeImpact`, and trend queries across test-management / agent / observability / dashboard-api.
- **Test-data management** (`@warden/fixtures`) — a `DataProvider` seam with SQL / API / Testcontainers
  providers, namespaced seed/teardown, and a `FixtureOrchestrator` (seed in order, teardown in reverse,
  never throws).
- **API & contract testing** — an `api` tier (Schemathesis OpenAPI fuzzing + Pact broker verification)
  and a contract-drift-impact unit in `@warden/coverage-sync`.
- **Device cloud grid** (`@warden/grid`) — a `GridProvider` seam + shard planner + local / BrowserStack /
  Sauce Labs / LambdaTest adapters + lane-aware CTRF merge.

### Added — Tier 2 (differentiators & moat)

- **Test-management sync** — a `TestManagementSync` seam with adapters for testomat.io (full,
  source-code-first, ID-stable), Qase, TestRail, Xray, Zephyr, and Allure TestOps.
- **Multi-SCM** (`@warden/vcs`) — a `VcsProvider` seam with GitHub / GitLab / Bitbucket / Azure DevOps
  adapters and a bridge onto coverage-sync's `GitHubAccess`.
- **Critical User Journey (CUJ) modeling** (`@warden/cuj`) — a first-class `Cuj` entity, worst-of health
  rollup, a CUJ-scoped merge gate (can only tighten), an exploratory-agent mission brief, and a board API.
- **Proactive self-healing** (`@warden/proactive-healer`) — opt-in pre-failure locator repair that opens
  a draft healing PR before tests go red.
- **Production-traffic recording** (`@warden/traffic`) — opt-in ingest → fail-closed PII scrub → cluster →
  synthesize specs → propose draft PRs + candidate CUJs.
- **Enterprise readiness** (`@warden/enterprise`) — OIDC auth (fail-closed), RBAC, an append-only audit
  sink, and per-tenant isolation for the hosted surfaces. `enterprise.auth.mode` defaults to `none`, so
  the self-hosted OSS core stays fully auth-optional.

### Added — dashboard & docs

- Dashboard panels for **Critical User Journeys**, **Visual Regression**, and **Flake Intelligence**.
- The **Warden Next** proposal set: a cited competitive gap analysis, an integrated-flow umbrella, and one
  design spec per capability.

### Security

- Forced `@opentelemetry/core >= 2.8.0` (GHSA-8988-4f7v-96qf) via a pnpm override.

### Notes

- All new capabilities are opt-in and default off; existing configs and pipelines are unaffected.
- Package count grew from 14 to 25; the test suite from 469 to ~1,180.

## [0.1.0] — 2026-07-08

Initial release. The core platform: PR-diff change surface + risk-scored tier selection; the
exploratory / generative / healer AI agents behind a provider interface (Claude default); Playwright +
Claude-in-Chrome browser engines; CTRF reporting across four GitHub surfaces with video/screenshot/trace
replay; SQLite test-management (Requirement→Test→Execution→Result) with a coverage matrix and flake
quarantine; a merge-gate verdict; the Sentinel dashboard; Prometheus/Grafana observability; Linear /
Jira / GitHub Projects requirement sync; a session recorder and learning studio; and the cross-repo
coverage-sync GitHub App.

[0.4.0]: https://github.com/QuintinBotes/warden/releases/tag/v0.4.0
[0.3.0]: https://github.com/QuintinBotes/warden/releases/tag/v0.3.0
[0.2.0]: https://github.com/QuintinBotes/warden/releases/tag/v0.2.0
[0.1.0]: https://github.com/QuintinBotes/warden/releases/tag/v0.1.0
