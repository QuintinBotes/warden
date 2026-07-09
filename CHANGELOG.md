# Changelog

All notable changes to Warden are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/QuintinBotes/warden/releases/tag/v0.2.0
[0.1.0]: https://github.com/QuintinBotes/warden/releases/tag/v0.1.0
