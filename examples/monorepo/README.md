# warden-example-monorepo

A tiny two-app monorepo — `apps/checkout` and `apps/cart` — showing how Warden's **selective
testing** scopes a run to only the module a PR actually touched. Copy this directory into your
own repo as a starting point; it is not part of the Warden pnpm workspace.

## What's here

- `apps/checkout/server.js` — a trivial `node:http` server: `GET /health`, `POST /checkout`.
- `apps/cart/server.js` — a trivial `node:http` server: `GET /health`, `GET /cart`,
  `POST /cart/items`.
- `tests/e2e/checkout.spec.ts` — hits only the checkout module; every test carries the
  `@apps/checkout` module tag.
- `tests/e2e/cart.spec.ts` — hits only the cart module; every test carries the `@apps/cart` module
  tag.
- `tests/cases/*.yaml` — one [Warden test-case](../../docs/architecture.md) per test.
- `playwright.config.ts` — starts both module servers (via Playwright's `webServer` array) before
  running.

## Run it yourself

```bash
npm install
npx playwright test
```

## The module-scoping story

Per [`docs/architecture.md`](../../docs/architecture.md) ("Modules → Playwright test tags") and
[`docs/cli.md`](../../docs/cli.md), Warden's `analyze` step derives test tags from the paths a PR
changed. In this monorepo:

- A PR that only touches `apps/checkout/**` derives the tag `@apps/checkout`, and Warden runs:
  ```bash
  npx warden run --grep "@apps/checkout" --artifacts-dir ./artifacts
  ```
  — only `tests/e2e/checkout.spec.ts` runs; `tests/e2e/cart.spec.ts` is skipped entirely.
- A PR that only touches `apps/cart/**` derives `@apps/cart` and runs only `cart.spec.ts`.
- A PR that touches a shared path (see `scope.sharedPaths` in
  [Configuration](../../docs/configuration.md)) escalates to the full suite instead.

This is what makes selective regression fast even as the number of modules (and their test
suites) grows — Warden runs exactly the tests whose module changed, not everything.

## Wiring Warden

1. Follow [Getting Started](../../docs/getting-started.md): run `npx warden init` in your repo (or
   copy `warden.config.ts` / `.github/workflows/ai-qa.yml` from the
   [GitHub Action guide](../../docs/github-action.md)) — the reference workflow lives at
   [`packages/github-action/ai-qa.example.yml`](../../packages/github-action/ai-qa.example.yml).
2. Make sure each `apps/*` directory maps to a distinct `@apps/<name>` tag on its tests, as done
   here — that 1:1 mapping is what lets `scope.highRiskPatterns` / tag derivation scope a run.
3. Start both module servers (`npm run dev:checkout` and `npm run dev:cart`) before the workflow's
   Playwright step, or let `webServer` in `playwright.config.ts` do it for you.
