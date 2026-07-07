# warden-example-next-app

A minimal login + checkout **web UI** — "Warden Demo Shop" — showing how a frontend project wires
up [Warden](../../README.md) for AI QA. Copy this directory into your own repo as a starting
point; it is not part of the Warden pnpm workspace.

Named `next-app` for parity with the [blueprint](../../docs/architecture.md)'s reference example,
but implemented as a dependency-free `node:http` server serving real, accessible HTML forms — no
framework required to try Warden's E2E story.

## What's here

- `src/server.js` — serves `GET /login` and `GET /checkout` (real `<form>`/`<label>`/`<button>`
  markup, a little inline JS) plus `POST /api/login` and `POST /api/checkout` JSON routes.
- `tests/e2e/login.spec.ts`, `tests/e2e/checkout.spec.ts` — Playwright E2E tests using only
  role-based locators (`getByRole`, `getByLabel`, `getByText`) — never CSS selectors — so tests
  survive markup changes.
- `tests/cases/*.yaml` — one [Warden test-case](../../docs/architecture.md) per test, linking a
  requirement (`requirementIds`) to the test case and the automated spec that proves it.
- `playwright.config.ts` — starts the app with `npm run dev` and waits on `/login` before running.

## Run it yourself

```bash
npm install
npm run dev          # starts the app on http://localhost:3000
npx playwright test  # in another shell
```

## How the tags map to Warden's tiers

| Tag | Meaning |
|-----|---------|
| `@smoke` | Always runs — the critical login -> checkout happy path. |
| `@regression` | Full-suite / selective-suite tests (invalid credentials, declined cards). |
| `@apps/auth` | Module tag for the login flow. |
| `@apps/checkout` | Module tag for the checkout flow. |

Because `@apps/auth` and `@apps/checkout` are separate tags, Warden's scope analysis can run only
the auth tests when just the login page changed, and only the checkout tests when just the
checkout page changed (see [`examples/monorepo`](../monorepo/README.md) for the module-scoping
story taken further, across whole apps).

## Wiring Warden

1. Follow [Getting Started](../../docs/getting-started.md): run `npx warden init` in your repo (or
   copy `warden.config.ts` / `.github/workflows/ai-qa.yml` from the
   [GitHub Action guide](../../docs/github-action.md)) — the reference workflow lives at
   [`packages/github-action/ai-qa.example.yml`](../../packages/github-action/ai-qa.example.yml).
2. Point the workflow's "Start application" step at `npm run dev` and `WARDEN_BASE_URL` at
   `http://localhost:3000`.
3. Set `scope.highRiskPatterns` to include `auth` and `checkout` (the default already does) so
   Warden's risk score climbs when these pages change and the AI exploratory agent kicks in.
