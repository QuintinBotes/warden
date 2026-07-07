# Contributing to Warden

Thanks for helping build Warden. This guide covers how the monorepo is organized and how to work in it.

## Prerequisites

- Node.js 20+
- pnpm 10+

```bash
pnpm install
pnpm -w build      # build every package
pnpm -w test       # run the full test suite
pnpm -w typecheck  # type-check all packages
pnpm -w lint       # formatting check (Prettier)
```

## Repository layout

```
warden/
├── packages/
│   ├── core/             # @warden/core — types, schemas, and every interface
│   ├── orchestrator/     # diff analysis, risk scoring, tier selection, gate
│   ├── agent/            # LLM provider + exploratory/generative/healer strategies
│   ├── runner/           # Playwright + Claude-Chrome engines, CTRF conversion
│   ├── test-management/  # SQLite history, YAML cases, coverage, flake quarantine
│   ├── reporter/         # CTRF + the four GitHub reporting surfaces
│   ├── cli/              # the `warden` binary
│   └── github-action/    # the published Action
├── apps/                 # (v2) the dashboard
├── examples/             # (v3) example apps + dogfood CI
└── docs/                 # documentation, specs, and the design system
```

## The golden rule: depend on `@warden/core`, not on each other

`@warden/core` is the **contract surface**. Every other package imports its types, schemas, and interfaces — and nothing imports another sibling package's internals. This is what keeps packages independently testable and buildable, and it's what lets the platform be built as a parallel swarm.

If you need a new shared type or interface, add it to `@warden/core` (and keep changes additive so existing packages don't break).

## Test-driven, hermetic tests

- Write the test first, watch it fail, then implement.
- Unit tests must be **hermetic**: no real network, LLM API, browser, or GitHub. Inject collaborators (accept a client/engine/octokit in a constructor or options argument) and use the fakes in `@warden/core/testing` (`fakeProvider`, `fakeBrowserSession`, `fakeReporter`, `fixtureChangeSurface`, `fixtureExecution`).

## Conventions

- TypeScript, ESM, `kebab-case.ts` filenames, public API from each package's `src/index.ts`.
- Throw typed errors from `@warden/core` (`WardenError` and subclasses), never bare strings.
- Formatting: Prettier (`singleQuote`, `semi`, `printWidth: 100`, `trailingComma: 'all'`). Run `pnpm -w lint`.

## How the platform is developed

Warden is built in **contract-first waves** (see [the specs](docs/superpowers/specs/)): one wave freezes `@warden/core`, then later waves implement against it in parallel. Each work-stream owns a disjoint set of paths and has a uniform definition of done. You can contribute to any single package without touching the others.

## Submitting changes

1. Branch from `main`.
2. Keep changes scoped to one package where possible.
3. Ensure `pnpm -w build && pnpm -w test && pnpm -w typecheck && pnpm -w lint` are all green.
4. Open a PR — Warden reviews its own PRs.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](README.md).
