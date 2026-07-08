# Warden

[![CI](https://github.com/QuintinBotes/warden/actions/workflows/ci.yml/badge.svg)](https://github.com/QuintinBotes/warden/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Open-source, AI-native QA platform.** Warden reads a pull request's diff, selects the tests that matter, sends an AI agent to break the build, and posts a merge-gate verdict back to GitHub. Claude is the default engine, abstracted behind a provider interface so any model can be swapped in. Everything is self-hostable and MIT-licensed.

## Documentation

Full docs live in **[`docs/`](docs/README.md)**:

- [Getting Started](docs/getting-started.md) — first AI QA report in ~10 minutes
- [Architecture](docs/architecture.md) · [Configuration](docs/configuration.md) · [CLI](docs/cli.md) · [GitHub Action](docs/github-action.md)
- [AI Providers & Engines](docs/providers-and-engines.md) · [Reporting](docs/reporting.md)
- [Deployment & Self-Hosting](docs/deployment.md) · [Design System](docs/design-system.md)
- [Contributing](CONTRIBUTING.md)

## Packages

| Package | What it does |
|---------|--------------|
| `@warden/core` | Shared types, Zod schemas, and every platform interface |
| `@warden/orchestrator` | Diff analysis, risk scoring, tier selection, and the merge gate |
| `@warden/agent` | LLM providers (Claude default) + exploratory / generative / healer strategies |
| `@warden/runner` | Playwright + Claude-Chrome browser engines and CTRF conversion |
| `@warden/test-management` | SQLite execution history, YAML test cases, coverage, flake quarantine |
| `@warden/reporter` | CTRF plus GitHub job-summary / PR-comment / check-run surfaces |
| `@warden/cli` | The `warden` command-line tool |
| `warden-action` | The published GitHub Action |
| `@warden/design-system` | "Sentinel" — tokens, themes, and dashboard components |
| `apps/dashboard` | The requirements-traceability dashboard |

Also included: `observability` (Prometheus + Grafana), `integrations` (Linear / Jira / GitHub Projects), `recorder` (session recording → test synthesis), `learning-studio`, and `dashboard-api`.

## Design system — "Sentinel"

A dark-first command center where **test status is the palette** (`PASS / FAIL / FLAKY / BLOCKED / SKIPPED / QUARANTINED`), the **portcullis** is the logo, and the quality gate is a live moment. Three themes ship — **Signal** (near-black, default), **Watch** (slate-teal), **Day** (light) — with a self-hosted Fira Code / Fira Sans pairing.

## Develop

```bash
pnpm install
pnpm -w build       # build all packages
pnpm -w test        # run the full test suite
pnpm -w typecheck   # type-check all packages
pnpm -w lint        # formatting check
```

Requires Node 20+ and pnpm 10+.

## License

MIT — see [LICENSE](LICENSE).
