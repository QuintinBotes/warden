// scripts/snapshot.mjs
//
// Builds the dashboard's data snapshot from the REAL Warden packages, then writes
// it to app/generated/data.json so the Next.js static export needs no database at
// build time.
//
// Pipeline: create a throwaway SQLite store in the OS temp dir, seed it with the
// canonical demo dataset (seedStore), drive the real SqliteDashboardApi, and shape
// the results into a UI-ready snapshot.
//
// Everything numeric here is DERIVED from the API. Only presentational copy
// (friendly test names, learning-module blurbs, the placeholder replay artwork)
// is hardcoded, and each such spot is called out in a comment.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteStore } from '@warden/test-management';
import { SqliteDashboardApi, seedStore } from '@warden/dashboard-api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'app', 'generated');
const OUT_FILE = join(OUT_DIR, 'data.json');

// ---------------------------------------------------------------------------
// Presentational lookups (copy only — never numbers).
// ---------------------------------------------------------------------------

/** Friendly, human-readable names for each seeded test case. */
const TEST_NAMES = {
  'TC-AUTH-001': 'auth › valid credentials sign-in',
  'TC-AUTH-002': 'auth › post-login redirect',
  'TC-AUTH-003': 'auth › logout clears session',
  'TC-CHECKOUT-001': 'checkout › pay with saved card',
  'TC-CHECKOUT-002': 'checkout › apply discount code',
  'TC-SEARCH-001': 'search › relevant results',
  'TC-SEARCH-002': 'search › fuzzy-match ranking',
};

/** Module label derived from a requirement / test id (REQ-AUTH-001 → "Auth"). */
function moduleOf(id) {
  const token = id.split('-')[1] ?? '';
  return token.charAt(0) + token.slice(1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Status mapping: core TestStatus → design-system SentinelStatus.
// ---------------------------------------------------------------------------

/** Map a single execution result to a SentinelStatus (flaky flag wins over FAIL). */
function resultToSentinel(r) {
  if (r.flakeFlag || r.status === 'FLAKY') return 'FLAKY';
  switch (r.status) {
    case 'PASS':
      return 'PASS';
    case 'FAIL':
      return 'FAIL';
    case 'SKIP':
      return 'SKIPPED';
    case 'BLOCKED':
      return 'BLOCKED';
    default:
      return 'NOT_TESTED';
  }
}

// Worst-wins ordering for rolling several test statuses up to one requirement status.
const SEVERITY = { FAIL: 5, BLOCKED: 4, FLAKY: 3, SKIPPED: 2, PASS: 1, NOT_TESTED: 0 };

function rollUp(statuses) {
  let worst = 'NOT_TESTED';
  for (const s of statuses) {
    if (SEVERITY[s] > SEVERITY[worst]) worst = s;
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Number formatting helpers.
// ---------------------------------------------------------------------------

const pct = (fraction) => Math.round(fraction * 1000) / 10; // one decimal, as a percent

/** Delta text + trend colour for a percentage-point metric. */
function ptsDelta(currPct, prevPct, higherIsBetter) {
  const d = Math.round((currPct - prevPct) * 10) / 10;
  if (d === 0) return { delta: 'no change', trend: 'flat' };
  const arrow = d > 0 ? '▲' : '▼';
  const improved = higherIsBetter ? d > 0 : d < 0;
  return { delta: `${arrow} ${Math.abs(d)} pts`, trend: improved ? 'up' : 'down' };
}

/** Delta text + trend colour for a millisecond metric (lower is better). */
function msDelta(currMs, prevMs) {
  const d = currMs - prevMs;
  if (d === 0) return { delta: 'no change', trend: 'flat' };
  const arrow = d > 0 ? '▲' : '▼';
  return {
    delta: `${arrow} ${(Math.abs(d) / 1000).toFixed(1)}s`,
    trend: d < 0 ? 'up' : 'down',
  };
}

function shortDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Placeholder replay artwork.
//
// The seeded media paths (media/checkout-002-4.png, …) point at files the E2E
// runner would capture but that don't exist in this static demo. Rather than ship
// broken <img>/<video> tags, we synthesise a small on-brand SVG "screenshot" and a
// downloadable trace as data URIs, derived from the failing result's real error
// message. This is presentational — the failure it depicts is real.
// ---------------------------------------------------------------------------

function mockScreenshot({ title, error }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
  <rect width="320" height="200" fill="#0a1113"/>
  <rect x="0" y="0" width="320" height="26" fill="#10191b"/>
  <circle cx="14" cy="13" r="4" fill="#ff5b60"/>
  <circle cx="28" cy="13" r="4" fill="#ffb04a"/>
  <circle cx="42" cy="13" r="4" fill="#43d19a"/>
  <rect x="60" y="7" width="220" height="12" rx="6" fill="#17262a"/>
  <rect x="24" y="48" width="160" height="14" rx="4" fill="#17262a"/>
  <rect x="24" y="74" width="272" height="10" rx="3" fill="#122024"/>
  <rect x="24" y="92" width="240" height="10" rx="3" fill="#122024"/>
  <rect x="24" y="128" width="272" height="44" rx="6" fill="rgba(255,91,96,0.12)" stroke="#ff5b60"/>
  <circle cx="42" cy="150" r="7" fill="none" stroke="#ff5b60" stroke-width="2"/>
  <text x="42" y="154" font-family="monospace" font-size="10" fill="#ff5b60" text-anchor="middle">!</text>
  <text x="60" y="147" font-family="monospace" font-size="10" fill="#ff5b60">${title}</text>
  <text x="60" y="162" font-family="monospace" font-size="9" fill="#d6dedd">${error}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function mockTrace(result, execution) {
  const trace = {
    testCaseId: result.testCaseId,
    status: result.status,
    durationMs: result.duration,
    error: result.errorMessage ?? null,
    execution: execution.id,
    trigger: execution.triggerRef,
    environment: execution.environment,
    startedAt: execution.startedAt,
    note: 'Synthesised trace for the Warden dashboard demo.',
  };
  const json = JSON.stringify(trace, null, 2);
  return `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
  const dbPath = join(tmpdir(), `warden-dashboard-snapshot-${Date.now()}.sqlite`);
  const store = new SqliteStore(dbPath);

  try {
    seedStore(store);
    const api = new SqliteDashboardApi(store);

    // Wide window so every seeded execution is captured.
    const range = { from: new Date('2000-01-01'), to: new Date('2100-01-01') };

    const [requirements, coverageCells, executions, flake] = await Promise.all([
      api.listRequirements(),
      api.coverageMatrix(),
      api.executions(range),
      api.flakeBoard(),
    ]);

    const [passRateTrend, flakeRateTrend, mttrTrend, coverageTrend] = await Promise.all([
      api.trends('passRate', range),
      api.trends('flakeRate', range),
      api.trends('mttr', range),
      api.trends('coverage', range),
    ]);

    // executions() returns chronological (oldest → newest); the last run is "current".
    const latest = executions[executions.length - 1];

    // ---- KPI tiles ---------------------------------------------------------
    // trends() yields one point per execution, chronological. Rates/coverage are
    // fractions; mttr is the mean duration (ms) of failing tests in each run.
    const passPts = passRateTrend.map((p) => pct(p.value));
    const flakePts = flakeRateTrend.map((p) => pct(p.value));
    const mttrPts = mttrTrend.map((p) => Math.round(p.value));
    const coveragePts = coverageTrend.map((p) => pct(p.value));

    const last = (a) => a[a.length - 1];
    const prev = (a) => a[a.length - 2] ?? a[a.length - 1];

    const kpis = {
      passRate: {
        label: 'Pass rate',
        value: `${last(passPts)}%`,
        tone: 'pass',
        points: passPts,
        ...ptsDelta(last(passPts), prev(passPts), true),
      },
      flakeRate: {
        label: 'Flake rate',
        value: `${last(flakePts)}%`,
        tone: 'flaky',
        points: flakePts,
        ...ptsDelta(last(flakePts), prev(flakePts), false),
      },
      // The dashboard-api "mttr" metric is the mean duration of failing tests per
      // run (there is no incident-resolution clock in the store), surfaced here in
      // seconds. Labelled MTTR to match the metric name.
      mttr: {
        label: 'MTTR',
        value: `${(last(mttrPts) / 1000).toFixed(1)}s`,
        tone: 'neutral',
        points: mttrPts,
        ...msDelta(last(mttrPts), prev(mttrPts)),
      },
      coverage: {
        label: 'Coverage',
        value: `${last(coveragePts)}%`,
        tone: 'pass',
        points: coveragePts,
        ...ptsDelta(last(coveragePts), prev(coveragePts), true),
      },
    };

    // ---- Latest gate (VerdictCard) ----------------------------------------
    // Derived from the latest run: a real (non-flaky) failure blocks; a flaky/
    // quarantined test warns; otherwise the gate is open.
    const latestSentinel = latest.results.map((r) => ({ r, s: resultToSentinel(r) }));
    const hardFails = latestSentinel.filter((x) => x.s === 'FAIL' || x.s === 'BLOCKED');
    const flakies = latestSentinel.filter((x) => x.s === 'FLAKY');
    const quarantinedCount = flake.filter((f) => f.quarantined).length;

    let decision = 'PASS';
    if (hardFails.length > 0) decision = 'BLOCK';
    else if (flakies.length > 0) decision = 'WARN';

    const blocker = hardFails[0]?.r;
    const prNumber = latest.triggerRef.replace(/^refs\/pull\//, '#');
    const reason =
      decision === 'BLOCK'
        ? `${TEST_NAMES[blocker.testCaseId] ?? blocker.testCaseId} failed on ${latest.triggerRef}: “${blocker.errorMessage ?? 'assertion failed'}”. ${quarantinedCount} test is quarantined for flakiness.`
        : decision === 'WARN'
          ? `All required checks passed, but ${flakies.length} flaky test needs attention before merge.`
          : 'All required checks passed. Safe to merge.';

    const latestGate = {
      decision,
      reason,
      meta: [
        {
          label: 'Trigger',
          value: latest.triggerType === 'pr' ? `PR ${prNumber}` : latest.triggerRef,
        },
        { label: 'Environment', value: latest.environment },
        { label: 'Pass rate', value: kpis.passRate.value },
        { label: 'Failing', value: `${hardFails.length} test${hardFails.length === 1 ? '' : 's'}` },
        {
          label: 'Quarantined',
          value: `${quarantinedCount} test${quarantinedCount === 1 ? '' : 's'}`,
        },
      ],
    };

    // ---- Coverage matrix ---------------------------------------------------
    // Rows are requirements; columns are the recent runs (a health-over-time
    // heatmap). Each cell rolls the requirement's linked tests up to one status
    // for that run. The trailing pill is the current (latest-run) status.
    const columns = executions.map((e) => shortDate(e.startedAt));

    const coverageRows = requirements.map((req) => {
      const cells = executions.map((exec, i) => {
        const statuses = exec.results
          .filter((r) => req.linkedTestIds.includes(r.testCaseId))
          .map(resultToSentinel);
        return { col: columns[i], status: rollUp(statuses) };
      });
      return {
        requirementId: req.id,
        title: req.title,
        tests: req.linkedTestIds,
        cells,
        status: cells[cells.length - 1]?.status ?? 'NOT_TESTED',
      };
    });

    // coverageCells is consumed above via the executions rollup; kept here only to
    // assert the API surface was exercised.
    void coverageCells;

    // ---- Results list (latest run) ----------------------------------------
    // Sorted so failures and flakes surface first — the reviewer's focus.
    const results = latest.results
      .map((r) => {
        const status = resultToSentinel(r);
        const hasShot = !!r.screenshotPath;
        const replay = hasShot
          ? {
              errorMessage: r.errorMessage ?? null,
              screenshots: [
                mockScreenshot({
                  title: TEST_NAMES[r.testCaseId] ?? r.testCaseId,
                  error: r.errorMessage ?? 'See trace for details',
                }),
                mockScreenshot({
                  title: `${moduleOf(r.testCaseId)} · retry ${r.retries + 1}`,
                  error: r.errorMessage ?? 'See trace for details',
                }),
              ],
              tracePath: mockTrace(r, latest),
            }
          : null;
        return {
          id: r.testCaseId,
          name: TEST_NAMES[r.testCaseId] ?? r.testCaseId,
          durationMs: r.duration,
          tags: [moduleOf(r.testCaseId).toLowerCase(), 'e2e'],
          status,
          replay,
        };
      })
      .sort((a, b) => {
        const sev = SEVERITY[b.status] - SEVERITY[a.status];
        return sev !== 0 ? sev : b.durationMs - a.durationMs;
      });

    // Default replay selection: the first result that captured media.
    const defaultSelectedId = results.find((r) => r.replay)?.id ?? results[0]?.id ?? null;

    // ---- Flake board -------------------------------------------------------
    // Full FlakeStat[] from the API, enriched with a friendly name and the pill
    // status the UI should render.
    const flakeBoard = flake
      .map((f) => ({
        testCaseId: f.testCaseId,
        name: TEST_NAMES[f.testCaseId] ?? f.testCaseId,
        flakeRate: f.flakeRate,
        ratePct: pct(f.flakeRate),
        quarantined: f.quarantined,
        pill: f.quarantined ? 'QUARANTINED' : f.flakeRate >= 0.8 ? 'FAIL' : 'FLAKY',
      }))
      .filter((f) => f.flakeRate > 0)
      .sort((a, b) => b.flakeRate - a.flakeRate);

    // ---- Learning modules (presentational copy) ---------------------------
    // The learning-content generator is a separate workstream; these blurbs stand
    // in for the modules it would produce from the two failing flows above.
    const learning = [
      {
        title: 'Taming the flaky post-login redirect',
        durationLabel: '4:12',
        embedId: 'wardn-auth-002',
      },
      {
        title: 'Why the discount-code check fails at checkout',
        durationLabel: '6:38',
        embedId: 'wardn-checkout-002',
      },
    ];

    const snapshot = {
      generatedAt: new Date().toISOString(),
      run: {
        trigger: latest.triggerType === 'pr' ? `PR ${prNumber}` : latest.triggerRef,
        environment: latest.environment,
        ranAt: shortDate(latest.startedAt),
        requirementCount: requirements.length,
        testCount: new Set(requirements.flatMap((r) => r.linkedTestIds)).size,
      },
      kpis,
      latestGate,
      coverageColumns: columns,
      coverageRows,
      results,
      defaultSelectedId,
      flake: flakeBoard,
      learning,
    };

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    console.log(`Wrote snapshot → ${OUT_FILE}`);
    console.log(
      `  gate=${decision}  requirements=${requirements.length}  runs=${executions.length}  flaky=${flakeBoard.length}`,
    );
  } finally {
    store.close();
    rmSync(dbPath, { force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
