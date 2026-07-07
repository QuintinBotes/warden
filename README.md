# Warden

**Open-source, AI-native QA platform.** Warden reads a pull request's diff, selects the tests that matter, sends an AI agent to break the build, and posts a merge-gate verdict back to GitHub. Claude is the default engine, abstracted behind a provider interface so any model can be swapped in. Everything is self-hostable and MIT-licensed.

> Status: **V1 in progress.** Specs written; `@warden/core` plus Wave 1 (`orchestrator`, `agent`, `runner`, `test-management`, `reporter`) are implemented and green. The CLI and GitHub Action land next. Built by a swarm of parallel agents against frozen contracts.

## Documentation

Full docs live in **[`docs/`](docs/README.md)**:

- [Getting Started](docs/getting-started.md) — first AI QA report in ~10 minutes
- [Architecture](docs/architecture.md) · [Configuration](docs/configuration.md) · [CLI](docs/cli.md) · [GitHub Action](docs/github-action.md)
- [AI Providers & Engines](docs/providers-and-engines.md) · [Reporting](docs/reporting.md)
- [Deployment & Self-Hosting](docs/deployment.md) · [Design System](docs/design-system.md)
- [Contributing](CONTRIBUTING.md)

## What's here

| Path | What it is |
|------|-----------|
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | The V1 + V2 **swarm build specs** and machine-readable manifests |
| [`docs/design/sentinel-design-system.html`](docs/design/sentinel-design-system.html) | The **Sentinel** design system (source) |
| [`packages/core/`](packages/core/) | `@warden/core` — types, Zod schemas, and every platform interface |

- **V1 spec** — [`2026-07-07-warden-v1-design.md`](docs/superpowers/specs/2026-07-07-warden-v1-design.md) · [manifest](docs/superpowers/specs/2026-07-07-warden-v1-swarm.manifest.yaml)
- **V2 spec** — [`2026-07-07-warden-v2-design.md`](docs/superpowers/specs/2026-07-07-warden-v2-design.md) · [manifest](docs/superpowers/specs/2026-07-07-warden-v2-swarm.manifest.yaml)

## How the build is organized

The specs are written to run **as a swarm**: one wave (`@warden/core`) freezes every shared type and interface, and later waves implement against those contracts — never against each other. Each work-stream owns a disjoint set of paths, has a uniform definition-of-done, and is built test-first. The manifests carry a **model-per-wave policy** (Opus for contract-defining/reasoning-heavy streams; Sonnet/Haiku only when a stream is fully self-contained).

```
warden/
├── packages/
│   └── core/          # @warden/core — the contract surface (built)
├── docs/
│   ├── superpowers/specs/   # V1 + V2 specs + swarm manifests
│   └── design/              # Sentinel design system
└── examples/          # (wave 3) next-app, express-api, monorepo
```

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

MIT.
