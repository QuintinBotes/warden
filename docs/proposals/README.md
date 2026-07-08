# Warden Proposals

Design proposals (RFCs) for Warden capabilities. Each is a self-contained spec: motivation, architecture against real seams, config, data flow, testing, and rollout. Proposals are drafts until built; a shipped proposal stays here as the design record.

## Shipped

- [Cross-Repo Coverage Sync](2026-07-08-cross-repo-coverage-sync.md) — the GitHub App that suggests tests + docs across linked repos. **Implemented.**

## Warden Next — roadmap

A competitive gap analysis turned into a buildable roadmap.

- **[Competitive gap analysis](2026-07-08-warden-next-competitive-gaps.md)** — what comparable products have that Warden lacks (the _why_), prioritized must-have → differentiator → nice-to-have.
- **[The integrated flow](2026-07-08-warden-next-integrated-flow.md)** — the umbrella: how all the capabilities below compose into one PR-processing pipeline (the _how_). **Read this first.**

### Capability specs

| Spec                                                            | Tier               | Package / seam                      |
| --------------------------------------------------------------- | ------------------ | ----------------------------------- |
| [Visual regression](2026-07-08-visual-regression.md)            | 1 · credibility    | `@warden/visual` · `VisualEngine`   |
| [Device cloud grid & sharding](2026-07-08-device-cloud-grid.md) | 1 · scale          | `GridProvider` (runner)             |
| [Test-data management](2026-07-08-test-data-management.md)      | 1 · credibility    | `@warden/fixtures` · `DataProvider` |
| [Flaky-test intelligence](2026-07-08-flaky-analytics.md)        | 1 · credibility    | extend `@warden/test-management`    |
| [Notifications & integrations](2026-07-08-notifications.md)     | 1 · credibility    | `QAPlatformPlugin` plugins          |
| [API & contract testing](2026-07-08-contract-api-testing.md)    | 1 · differentiator | `api` tier (runner)                 |
| [Accessibility & performance budgets](2026-07-08-a11y-perf.md)  | 1 · credibility    | `a11y` + `perf` checks              |
| [Test-management sync](2026-07-08-test-management-sync.md)      | 2 · differentiator | `TestManagementSync` (integrations) |
| [CUJ modeling](2026-07-08-cuj-modeling.md)                      | 2 · differentiator | `@warden/core` CUJ + `@warden/cuj`  |
| [Proactive self-healing](2026-07-08-proactive-self-healing.md)  | 2 · moat           | extend `@warden/agent` healer       |
| [Multi-SCM support](2026-07-08-multi-scm.md)                    | 2 · differentiator | `VcsProvider` · `@warden/vcs`       |
| [Production-traffic recording](2026-07-08-traffic-recording.md) | 2 · moat           | `@warden/traffic`                   |
| [Enterprise readiness](2026-07-08-enterprise-readiness.md)      | 2 · moat           | `@warden/enterprise`                |

Every capability is additive to `@warden/core`, defaulted off, independently shippable, and plugs into the two shared contracts (the CUJ rollup and the single BLOCK/WARN/PASS gate + CTRF report) described in the integrated-flow doc.
