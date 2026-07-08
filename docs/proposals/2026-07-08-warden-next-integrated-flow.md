# Proposal: Warden Next — The Integrated Flow

- **Status:** Draft (umbrella architecture) · **Date:** 2026-07-08
- **Relates to:** [warden-next-competitive-gaps.md](warden-next-competitive-gaps.md) (the gap analysis) and the thirteen per-capability specs listed below.

## Summary

The competitive gap analysis produced thirteen capability specs. This umbrella doc shows how they compose into **one coherent flow** — how a single pull request travels through Warden once every piece is in place — and defines the shared contracts (the gate, the report, the config surface, the VCS seam) that keep them from becoming thirteen disconnected features. Read this first; then read each capability spec for its internals.

## The per-capability specs

| #   | Spec                                                            | Package / seam                          | Gap § |
| --- | --------------------------------------------------------------- | --------------------------------------- | ----- |
| 1   | [Visual regression](2026-07-08-visual-regression.md)            | new `@warden/visual` · `VisualEngine`   | 1.1   |
| 2   | [Device cloud grid & sharding](2026-07-08-device-cloud-grid.md) | `GridProvider` in runner                | 1.2   |
| 3   | [Test-data management](2026-07-08-test-data-management.md)      | new `@warden/fixtures` · `DataProvider` | 1.3   |
| 4   | [Flaky-test intelligence](2026-07-08-flaky-analytics.md)        | extend `@warden/test-management`        | 1.4   |
| 5   | [Notifications & integrations](2026-07-08-notifications.md)     | `QAPlatformPlugin` plugins              | 1.5   |
| 6   | [API & contract testing](2026-07-08-contract-api-testing.md)    | `api` tier in runner                    | 1.6   |
| 7   | [Accessibility & performance budgets](2026-07-08-a11y-perf.md)  | `a11y` + `perf` checks                  | 1.7   |
| 8   | [Test-management sync](2026-07-08-test-management-sync.md)      | `TestManagementSync` in integrations    | 2.1   |
| 9   | [CUJ modeling](2026-07-08-cuj-modeling.md)                      | `@warden/core` CUJ entity               | 2.2   |
| 10  | [Proactive self-healing](2026-07-08-proactive-self-healing.md)  | extend `@warden/agent` healer           | 2.3   |
| 11  | [Multi-SCM support](2026-07-08-multi-scm.md)                    | `VcsProvider` seam                      | 2.4   |
| 12  | [Production-traffic recording](2026-07-08-traffic-recording.md) | new `@warden/traffic`                   | 2.5   |
| 13  | [Enterprise readiness](2026-07-08-enterprise-readiness.md)      | hosted surfaces (dashboard + App)       | 2.6   |

## The integrated flow (end to end)

Once all pieces land, a PR flows through Warden like this. **Bold** marks a new capability; the rest already exists.

1. **Trigger.** A PR/MR opens on GitHub, **GitLab, Bitbucket, or Azure DevOps** — normalized by the **`VcsProvider`** seam (#11) so everything downstream is host-agnostic.
2. **Change surface + risk.** The orchestrator computes the diff's change surface and risk score (existing).
3. **Selection.** Tier selection picks what to run — now expanded to include **visual (#1), a11y/perf (#7), and API/contract (#6)** alongside functional tiers, and scoped by any touched **CUJs (#9)**.
4. **Provision.** **Test-data fixtures (#3)** seed isolated, namespaced data and spin up the environment before anything runs.
5. **Execute.** The runner fans the selected tiers across the **device-cloud grid with parallel sharding (#2)** — real browsers/devices at scale — capturing video/screenshots/traces (existing). **Visual (#1)**, **a11y + perf (#7)**, and **contract/API (#6)** checks run as their own tiers and emit CTRF like everything else.
6. **Agents.** The exploratory agent runs against a **CUJ (#9)** as its mission brief; the generative agent writes new specs; the healer runs in its existing reactive mode plus an optional **proactive pass (#10)** that pre-heals locators when the change surface shows UI drift.
7. **Record & reconcile.** Results land in the SQLite store and the coverage matrix; **flaky analytics (#4)** scores and trends flakiness; **test-management sync (#8)** round-trips specs, IDs, and results with the team's system of record (testomat.io / Qase / TestRail / Xray / Zephyr / Allure TestOps).
8. **Gate.** The merge gate returns BLOCK/WARN/PASS — now able to gate on **CUJ health (#9)** and on visual/a11y/perf/contract results, not just functional pass/fail.
9. **Report.** CTRF is surfaced across the four VCS surfaces (via #11), and **notifications (#5)** push the verdict to Slack/Teams/PagerDuty/webhooks.
10. **Suggest.** The cross-repo coverage-sync App proposes tests + docs across linked repos (existing), now able to reconcile with test-management (#8) and flag contract drift (#6).
11. **Dashboard.** The Sentinel dashboard shows every board — coverage, trends, flake, replay, plus a **CUJ board (#9)** and **visual-diff review (#1)** — behind **SSO/RBAC on hosted deployments (#13)**.
12. **Learn & grow.** Opt-in **production-traffic recording (#12)** clusters real usage into candidate journeys → the generative agent turns them into specs and proposes new **CUJs (#9)**, closing the loop back to step 3.

## The organizing idea: CUJs on top, a shared gate underneath

Two contracts keep this coherent:

- **CUJ as the top-level unit (#9).** Tests, visual checks, a11y/perf, and contract results all roll up into _journeys_. The gate, the dashboard, and the exploratory agent all speak CUJ, so the product answers "is _checkout_ safe to ship?" rather than "did 1,412 tests pass?".
- **One gate, one report.** Every new check (#1, #6, #7) emits **CTRF findings** and contributes to the single **BLOCK/WARN/PASS** gate with configurable thresholds. New capabilities plug into these two contracts instead of inventing their own verdict surfaces.

## Shared contracts touched

- **`@warden/core` (additive only):** a `CUJ` entity (#9); finding/status roles for visual, a11y, perf, contract; a `VcsProvider` interface (#11); a `TestManagementSync` interface (#8). No existing signature changes.
- **Config:** each capability adds an additive block to `WardenConfigSchema` (`visual`, `grid`, `fixtures`, `retry`/flake, `notifications`, `api`, `a11y`, `perf`, `testManagement`, `cujs`, `traffic`). Defaults keep every capability off until configured.
- **Gate & reporter:** extended to consume the new tiers; unchanged for existing ones.

## Sequencing

1. **Credibility (Tier 1):** visual (#1), notifications (#5), a11y/perf (#7), flaky analytics (#4) — highest adoption-impact per unit effort.
2. **Differentiators (Tier 2 + remaining Tier 1):** test-management sync (#8), CUJ modeling (#9), contract testing (#6), multi-SCM (#11).
3. **Moat & scale:** proactive healing (#10), traffic recording (#12), device grid (#2), test-data (#3), enterprise (#13).

CUJ modeling (#9) and the `VcsProvider` seam (#11) are **enablers** — landing them early makes the rest compose more cleanly, so they're worth pulling forward within their tiers.

## Risks & open items

- **Scope discipline:** each capability is independently shippable; resist coupling them beyond the two shared contracts above.
- **Config sprawl:** a dozen additive config blocks — keep them defaulted-off and documented in one place.
- **Hosted vs OSS split:** enterprise features (#13) and traffic recording (#12) imply a hosted tier; decide what stays in the MIT core.
- **CUJ authorship:** CUJs are only as good as their definitions — traffic recording (#12) and test-management sync (#8) should help seed them rather than relying on hand-authoring.
