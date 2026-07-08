import type {
  Cuj,
  CujHealthReport,
  CujHealthStatus,
  CujSignal,
  CujStepHealth,
  TestResult,
} from '@warden/core';

/**
 * The pure worst-of CUJ health rollup. Follows the same "latest result per test case" logic as
 * `computeCoverage` in `@warden/test-management`: `results` are chronological (oldest first) and
 * the last entry per test case wins.
 *
 * Rules (documented in the proposal):
 *  - No linked test has a result → `NOT_TESTED`.
 *  - Any linked test's latest result is `FAIL` (or `BLOCKED`) → `BROKEN`.
 *  - Else pass rate = passed / linked-with-results; below `thresholds.minPassRatePercent`
 *    → `DEGRADED`.
 *  - A `CujSignal` with `passed: false` → `DEGRADED` (or `BROKEN` when `blocking`); an *absent*
 *    signal never downgrades — absence is not failure.
 *  - Otherwise `HEALTHY`. Per-step status is the worst-of that step's own `testIds`.
 */

/** Severity ordering so worst-of is a plain numeric max. */
const SEVERITY: Record<CujHealthStatus, number> = {
  HEALTHY: 0,
  NOT_TESTED: 1,
  DEGRADED: 2,
  BROKEN: 3,
};

/** Compare two statuses; the more severe (higher) one wins. */
export function worstStatus(a: CujHealthStatus, b: CujHealthStatus): CujHealthStatus {
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

export function statusSeverity(status: CujHealthStatus): number {
  return SEVERITY[status];
}

/** Map a set of latest results to a step-level status (worst-of). */
function statusForResults(results: TestResult[], linkedCount: number): CujHealthStatus {
  if (linkedCount === 0 || results.length === 0) return 'NOT_TESTED';
  if (results.some((r) => r.status === 'FAIL' || r.status === 'BLOCKED')) return 'BROKEN';
  // A missing result for a linked test, or any non-PASS terminal status, is a degradation.
  if (results.length < linkedCount) return 'DEGRADED';
  if (results.every((r) => r.status === 'PASS')) return 'HEALTHY';
  return 'DEGRADED';
}

/** Index the latest result per test case (last write wins), matching `computeCoverage`. */
function latestByTestCase(results: TestResult[]): Map<string, TestResult> {
  const latest = new Map<string, TestResult>();
  for (const result of results) latest.set(result.testCaseId, result);
  return latest;
}

export function computeCujHealth(
  cuj: Cuj,
  latestResults: TestResult[],
  signals: CujSignal[] = [],
  opts: { now?: Date } = {},
): CujHealthReport {
  const latest = latestByTestCase(latestResults);

  // The journey's linked tests are the union of every step's testIds.
  const linkedIds = new Set<string>();
  for (const step of cuj.steps) for (const id of step.testIds) linkedIds.add(id);

  const resolved: TestResult[] = [];
  for (const id of linkedIds) {
    const result = latest.get(id);
    if (result) resolved.push(result);
  }

  // Base status from the functional tests. The pass-rate threshold (default 100%) is what turns
  // a non-BROKEN-but-imperfect journey DEGRADED — the denominator is the linked tests that have
  // a result, per the proposal.
  const withResults = resolved.length;
  const passCount = resolved.filter((r) => r.status === 'PASS').length;
  const passRatePercent = withResults === 0 ? 0 : (passCount / withResults) * 100;

  let status: CujHealthStatus;
  if (linkedIds.size === 0 || withResults === 0) {
    status = 'NOT_TESTED';
  } else if (resolved.some((r) => r.status === 'FAIL' || r.status === 'BLOCKED')) {
    status = 'BROKEN';
  } else if (passRatePercent < cuj.thresholds.minPassRatePercent) {
    status = 'DEGRADED';
  } else {
    status = 'HEALTHY';
  }

  // Fold in already-evaluated non-functional signals. An absent signal is simply not in the
  // array and never downgrades; only an actually-evaluated `passed: false` does.
  const failingSignals = signals.filter((s) => s.passed === false);
  for (const signal of failingSignals) {
    status = worstStatus(status, signal.blocking ? 'BROKEN' : 'DEGRADED');
  }

  const steps: CujStepHealth[] = cuj.steps
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((step) => {
      const stepResults: TestResult[] = [];
      for (const id of step.testIds) {
        const result = latest.get(id);
        if (result) stepResults.push(result);
      }
      let stepStatus = statusForResults(stepResults, step.testIds.length);
      // Signals scoped to this step escalate its status too.
      for (const signal of failingSignals) {
        if (signal.step === step.name) {
          stepStatus = worstStatus(stepStatus, signal.blocking ? 'BROKEN' : 'DEGRADED');
        }
      }
      return { order: step.order, name: step.name, status: stepStatus };
    });

  return {
    cujId: cuj.id,
    name: cuj.name,
    owningTeam: cuj.owningTeam,
    tier: cuj.tier,
    status,
    passRatePercent,
    steps,
    failingSignals,
    computedAt: (opts.now ?? new Date()).toISOString(),
  };
}
