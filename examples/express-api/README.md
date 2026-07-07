# warden-example-express-api

A tiny, self-contained Express JSON API — "Warden Demo Shop" — showing how a **backend-only**
project wires up [Warden](../../README.md) for AI QA. Copy this directory into your own repo as a
starting point; it is not part of the Warden pnpm workspace.

## What's here

- `src/server.js` — an in-memory Express app: `GET /health`, `POST /login`, `GET /cart`,
  `POST /checkout`.
- `tests/api/*.spec.ts` — Playwright API tests, driven with the `request` fixture (no browser).
- `tests/cases/*.yaml` — one [Warden test-case](../../docs/architecture.md) per test, the
  traceability link between a requirement (`requirementIds`), a test case (`id`), and the
  automated spec that proves it (`automation.filePath` / `automation.testName`).
- `playwright.config.ts` — starts the API with `npm run dev` and waits on `/health` before running.

## Run it yourself

```bash
npm install
npm run dev          # starts the API on http://localhost:3000
npx playwright test  # in another shell
```

## How the tags map to Warden's tiers

Every test title carries its own tags (Warden's runner selects tiers by grepping test titles —
see [`docs/cli.md`](../../docs/cli.md)):

| Tag | Meaning |
|-----|---------|
| `@smoke` | Always runs — fast, critical-path checks. |
| `@regression` | Full-suite / selective-suite tests. |
| `@api` | Marks this as an API-layer test (Warden's `runApiTests` helper grep-defaults to `@api`). |
| `@apps/checkout` | Module tag — lets Warden scope a run to only the checkout module when that's what changed. |

## Wiring Warden

1. Follow [Getting Started](../../docs/getting-started.md): run `npx warden init` in your repo (or
   copy `warden.config.ts` / `.github/workflows/ai-qa.yml` from the
   [GitHub Action guide](../../docs/github-action.md)) — the reference workflow lives at
   [`packages/github-action/ai-qa.example.yml`](../../packages/github-action/ai-qa.example.yml).
2. Point the workflow's "Start application" step at `npm run dev` and `WARDEN_BASE_URL` at
   `http://localhost:3000`.
3. Warden will run `@smoke` on every PR, scope `@regression` to changed modules via
   `scope.highRiskPatterns` / tag derivation, and load `tests/cases/*.yaml` for requirement
   traceability in the PR report.
