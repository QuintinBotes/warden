# Example: dashboard self-test (dogfood)

Warden testing **its own Sentinel dashboard**, then showing the run **in that dashboard** — a
local, end-to-end loop you can watch on your own machine:

1. Serve the dashboard's static export over **http** (so its `/_next/…` assets actually load —
   a `file://` open can't do that).
2. Run Warden's **`@smoke` tier** against it with Playwright, and **persist** the run into a
   SQLite store (`warden run --db`).
3. Rebuild the dashboard snapshot **from that store**, so the Sentinel UI renders your real run.

Unlike the other examples (which are self-contained apps you copy into your own repo), this one
is **monorepo-internal**: it serves `apps/dashboard/out` and drives the workspace packages, so it
lives and runs inside this repo.

## Prerequisites

```bash
# 1. Build the monorepo (from the repo root) — builds the CLI + dashboard packages.
pnpm -w build

# 2. Install this example's dev deps + the browser (from this directory).
cd examples/dashboard-selftest
pnpm install
npx playwright install chromium
```

## Run it

```bash
# from examples/dashboard-selftest
pnpm run selftest
```

That single command:

- builds the dashboard export and serves it over http,
- runs the three `@smoke` specs in [`tests/dashboard.spec.ts`](tests/dashboard.spec.ts) against it,
- persists the run to `warden.sqlite`,
- links one requirement per test to the run (so **Requirement health** lights up), and
- rebuilds the dashboard **from your run**.

## See your run in the dashboard

```bash
# from the repo root
pnpm --filter dashboard dev      # http://localhost:3000
```

You'll see **your** run: Trends (pass/flake/MTTR/coverage), Requirement health linked to the real
`testCaseId`s, the **Latest verdict** gate, and the Test results list — all from the run you just
executed.

### What's real vs. demo

The dashboard has more panels than a single local run can fill. When rendering a real store
(`WARDEN_STORE` set), Warden shows **honest empty states** for the panels no run has populated yet,
rather than demo data that would contradict your run:

| Panel | Source for a real run |
| --- | --- |
| Trends · Requirement health · Latest verdict · Test results · Flake & quarantine | **Your run** (derived from the store) |
| Coverage Sync · Critical User Journeys · Visual Regression · Flake Intelligence · Learning | Empty state — these need cross-repo / CUJ / visual-baseline / multi-run data a single run doesn't produce |

Run it a few times and the **Trends** sparklines and **Flake** history start to fill in, since each
run appends to the same `warden.sqlite`.

## Other ways to view the results

- **CTRF report + gate summary:** `warden-artifacts/ctrf-report.json` and `warden-artifacts/job-summary.md`.
- **Playwright's own report** (per-test traces + video): `npx playwright show-report`.

## How it fits together

```
serve-static.mjs ── serves apps/dashboard/out over http
        │
        ▼
warden run --grep @smoke --db warden.sqlite   ── Playwright drives the dashboard, run persisted
        │
        ▼
scripts/seed-requirements.mjs warden.sqlite    ── link requirements to the run's testCaseIds
        │
        ▼
WARDEN_STORE=warden.sqlite  pnpm --filter dashboard snapshot   ── data.json built from your run
        │
        ▼
pnpm --filter dashboard dev                    ── open the dashboard, see your run
```
