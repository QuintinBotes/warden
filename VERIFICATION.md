# Verification report

_Generated during the autonomous overnight build. Every claim below was executed, not assumed._

## Test barrier (authoritative, re-run at the end)

```
pnpm -w test        → 468 passed (468) across 81 files
pnpm -w typecheck   → PASS (0 errors)
pnpm -w build       → PASS (14 packages, ESM + .d.ts)
pnpm -w lint        → PASS (Prettier clean)
```

14 packages + `apps/dashboard`; ~9,470 source LOC (excluding tests/dist).

## The solution actually runs

### CLI (the documented quick-start), in a clean temp dir

```
warden init      → scaffolds warden.config.ts + .github/workflows/ai-qa.yml   ✓
warden plan      → emits the Test Plan Markdown                                ✓
warden agent     → keyless (fakeProvider) writes a report JSON                 ✓  (strategy generative)
warden analyze   → test_tags= / risk_score=2 / run_full_suite=false            ✓  (GitHub-Actions output format)
```

> A real bug was found **and fixed** during this verification: `warden init` previously scaffolded a config that `import`ed `@warden/core`, which failed in a bare dir (e.g. `npx warden` before install). It now scaffolds an import-free config, so the quick-start works anywhere. Re-verified: `init → agent → report.json` succeeds in a clean temp dir.

### Dashboard

```
pnpm --filter dashboard build → apps/dashboard/out/index.html (40,665 bytes)   ✓
pnpm --filter dashboard typecheck → clean                                      ✓
```

The static export contains real design-system output (`sentinel-verdict--block`, `data-theme="signal"`, coverage/flake sections) rendered from a snapshot produced by the real `@warden/dashboard-api` + SQLite pipeline (`scripts/snapshot.mjs`).

### Example apps

14 Warden YAML test-cases across the three examples validate against the real `@warden/test-management` loader (`loadYamlCases`). Playwright specs use role-based locators and module-scoped tags.

### Self-host stack

`deploy/docker-compose.yml`, `packages/observability/monitoring/{docker-compose.yml,prometheus.yml}` are valid YAML; the Grafana dashboard JSON parses (7 panels).

## CI proven green on GitHub (PR #2)

- **CI** workflow — install (frozen lockfile) → build → typecheck → test → lint: **pass** (1m14s)
- **Warden Self-Test** — Warden analyzed its own PR's change surface (keyless) and emitted a plan to the job summary: **pass** (41s)

(A YAML gotcha — an unquoted `#` parsed as a comment — was caught and fixed here; both checks are green.)

## Security

- Repo-wide secret scan: **clean** — no keys/tokens/`.env` files tracked.
- `.gitignore` excludes `.env*`, `*.pem`/`*.key`, `*.sqlite`, `.next/`, `out/`.
- All unit tests are hermetic (no real network, LLM API, browser, or GitHub); every external client is injected.

## How to reproduce

```bash
pnpm install
pnpm -w build && pnpm -w test && pnpm -w typecheck && pnpm -w lint
pnpm --filter dashboard build      # → apps/dashboard/out/
node packages/cli/dist/bin/warden.js --help
```
