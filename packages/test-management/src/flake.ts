import {
  CTRFReportSchema,
  type CTRFReport,
  type CTRFTest,
  type FlakeImpact,
  type TestResult,
} from '@warden/core';

/** Fraction of `history` that are FAIL results; `0` for an empty history. */
export function computeFlakeRate(history: TestResult[]): number {
  if (history.length === 0) return 0;
  const fails = history.filter((r) => r.status === 'FAIL').length;
  return fails / history.length;
}

/** A test case should be quarantined once its flake rate lands strictly between 20% and 80%. */
export function shouldQuarantine(rate: number): boolean {
  return rate > 0.2 && rate < 0.8;
}

/**
 * Stable identity for a CTRF test: `filePath::name` when a file path is present, else the bare
 * name. Mirrors the identity `ctrfToExecution` hashes into a `testCaseId`, so retry-reconciliation
 * keys line up with the execution the CLI ultimately reports.
 */
function ctrfIdentity(test: CTRFTest): string {
  return test.filePath ? `${test.filePath}::${test.name}` : test.name;
}

/**
 * Given the failing test names of a run, decide which to retry. With `retryOnlyKnownFlaky`, only
 * names already in the `knownFlaky` set are retried (a fresh failure stays a real FAIL); otherwise
 * every failing name is a candidate.
 */
export function selectRetryCandidates(
  failedTestNames: string[],
  opts: { retryOnlyKnownFlaky: boolean; knownFlaky: ReadonlySet<string> },
): string[] {
  if (!opts.retryOnlyKnownFlaky) return failedTestNames;
  return failedTestNames.filter((name) => opts.knownFlaky.has(name));
}

/** The reconciled result of folding an original run plus its retry attempts. */
export interface RetryReconciliation {
  /** One entry per test (keyed by identity), the last attempt's status winning. */
  report: CTRFReport;
  /** Per test identity: how many extra attempts ran and whether it flaked (failed then passed). */
  meta: Map<string, { retries: number; flakeFlag: boolean }>;
}

/**
 * Folds an original CTRF report plus zero or more retry-attempt reports (each scoped to a failing
 * subset) into one reconciled report. A test's final status is its LAST attempt; `flakeFlag` is
 * true when an earlier attempt failed but a later one passed; `retries` is the number of extra
 * attempts the test appeared in. Pure — no clock reads, no I/O — so retry sequences are trivial to
 * construct as fixtures. Tests are keyed strictly by identity (`filePath::name`), so a crash
 * mid-round degrades to "fewer attempts recorded", never cross-contaminating another test.
 */
export function reconcileRetries(attempts: CTRFReport[]): RetryReconciliation {
  const order: string[] = [];
  const seen = new Set<string>();
  const appearances = new Map<string, CTRFTest[]>();

  for (const attempt of attempts) {
    for (const test of attempt.results.tests) {
      const id = ctrfIdentity(test);
      if (!seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
      const list = appearances.get(id) ?? [];
      list.push(test);
      appearances.set(id, list);
    }
  }

  const meta = new Map<string, { retries: number; flakeFlag: boolean }>();
  const tests: CTRFTest[] = [];
  for (const id of order) {
    const list = appearances.get(id) ?? [];
    const final = list[list.length - 1];
    if (!final) continue;
    const retries = list.length - 1;
    const earlierFailed = list.slice(0, -1).some((t) => t.status === 'failed');
    const flakeFlag = final.status === 'passed' && earlierFailed;
    meta.set(id, { retries, flakeFlag });
    tests.push({ ...final });
  }

  const first = attempts[0];
  const last = attempts[attempts.length - 1];
  const countStatus = (status: CTRFTest['status']): number =>
    tests.filter((t) => t.status === status).length;

  return {
    report: CTRFReportSchema.parse({
      results: {
        tool: first?.results.tool ?? { name: 'warden' },
        summary: {
          tests: tests.length,
          passed: countStatus('passed'),
          failed: countStatus('failed'),
          skipped: countStatus('skipped'),
          pending: countStatus('pending'),
          other: countStatus('other'),
          start: first?.results.summary.start ?? 0,
          stop: last?.results.summary.stop ?? 0,
        },
        tests,
      },
    }),
    meta,
  };
}

/**
 * Quantified cost of a test's flakiness from its chronological `history`: the extra runs it
 * caused (`retries` summed), CI time lost to those retries (modelled as `retries × duration`,
 * in minutes), and the gate blocks its retry pass avoided (results that flaked to a non-FAIL).
 */
export function computeFlakeImpact(testCaseId: string, history: TestResult[]): FlakeImpact {
  let reRunsCaused = 0;
  let retryMs = 0;
  let gateBlocksAvoided = 0;
  for (const r of history) {
    reRunsCaused += r.retries;
    retryMs += r.retries * r.duration;
    if (r.flakeFlag && r.status !== 'FAIL') gateBlocksAvoided += 1;
  }
  return {
    testCaseId,
    reRunsCaused,
    ciMinutesLost: retryMs / 60000,
    gateBlocksAvoided,
  };
}

/**
 * Hours between the first `quarantined` event of the flaky episode ending at the most recent
 * `cleared` event and that `cleared` event, for `testCaseId`. Returns `undefined` when the test
 * was never quarantined, or is still quarantined (no `cleared` event closes the latest episode).
 */
export function computeMttrToDeflake(
  events: { testCaseId: string; event: 'quarantined' | 'cleared'; at: Date }[],
  testCaseId: string,
): number | undefined {
  const sorted = events
    .filter((e) => e.testCaseId === testCaseId)
    .slice()
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  let clearedIdx = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]?.event === 'cleared') {
      clearedIdx = i;
      break;
    }
  }
  if (clearedIdx === -1) return undefined;

  const cleared = sorted[clearedIdx];
  if (!cleared) return undefined;

  let openAt: Date | undefined;
  for (let i = clearedIdx - 1; i >= 0; i--) {
    const e = sorted[i];
    if (!e || e.event === 'cleared') break;
    openAt = e.at;
  }
  if (!openAt) return undefined;

  return (cleared.at.getTime() - openAt.getTime()) / 3_600_000;
}
