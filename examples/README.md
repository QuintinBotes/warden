# Warden Examples

Three small, self-contained apps that show how a project adopts [Warden](../README.md) for AI QA.
Each is a standalone demo — copy the whole directory into your own repository. None of these are
pnpm workspace members of this repo; they carry their own `package.json` and are never built or
installed from here.

| Example | What it demonstrates |
|---------|----------------------|
| [`express-api/`](express-api/README.md) | A backend-only API project: Playwright **API tests** (`request` fixture, no browser) against a tiny Express JSON API. |
| [`next-app/`](next-app/README.md) | A frontend project: Playwright **E2E tests** with role-based locators (`getByRole`/`getByLabel`) against a login + checkout web UI. |
| [`monorepo/`](monorepo/README.md) | A multi-app repo: **module-scoped test tags** (`@apps/checkout`, `@apps/cart`) that let Warden's selective testing scope a run to only the module a PR changed. |
| [`dashboard-selftest/`](dashboard-selftest/README.md) | **Dogfood** (monorepo-internal): Warden runs its `@smoke` tier against its own Sentinel dashboard over http, **persists the run** (`warden run --db`), and rebuilds the dashboard **from that run** so you can see real results in the UI locally. |

All three share one fictional product, "Warden Demo Shop," and the same requirement IDs
(`ISSUE-101` auth, `ISSUE-150` cart, `ISSUE-201` checkout) so you can compare how the same
underlying flow — log in, view cart, check out — is tested at three different layers/shapes of
project.

## How each example wires Warden

Every example follows the same three steps described in [Getting Started](../docs/getting-started.md):

1. **Scaffold**: run `npx warden init` in your copied project (or hand-copy `warden.config.ts` and
   `.github/workflows/ai-qa.yml` from the [GitHub Action guide](../docs/github-action.md) — the
   reference workflow lives at [`packages/github-action/ai-qa.example.yml`](../packages/github-action/ai-qa.example.yml)).
2. **Add the `ANTHROPIC_API_KEY` secret** so the AI exploratory tier and PR report can run.
3. **Start the app** in CI (each example's `npm run dev`) and point `WARDEN_BASE_URL` at it, so
   Warden's smoke, selective, and exploratory tiers can drive it.

From there, Warden's pipeline is identical across all three:

- **Analyze** the PR diff, derive test tags from changed paths, and score risk
  ([Architecture](../docs/architecture.md)).
- **Run** the right tiers: `@smoke` always; `@regression` scoped by module tag (`@apps/checkout`,
  `@apps/auth`, `@apps/cart`, ...); the AI exploratory agent above the risk threshold.
- **Report** to a GitHub Job Summary, a PR review comment, inline check annotations, and a CTRF
  artifact ([Reporting](../docs/reporting.md)).
- **Gate** the merge on the exit criteria in `warden.config.ts`
  ([Configuration](../docs/configuration.md)).

Each example also ships `tests/cases/*.yaml` — one [Warden test-case](../docs/architecture.md) per
automated test, linking a requirement ID to the test case and the exact Playwright spec/testName
that proves it. This is the traceability layer the dashboard (and the PR report's coverage
summary) reads from.

## Directory layout

```
examples/
├── express-api/    # Express JSON API + Playwright API tests
├── next-app/       # login + checkout web UI + Playwright E2E tests (role-based locators)
└── monorepo/       # apps/checkout + apps/cart + module-scoped test tags
```

See each example's own README for how to run it and exactly how its tags map to Warden's tiers.
