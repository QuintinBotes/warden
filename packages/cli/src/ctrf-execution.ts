import {
  contentId,
  type CTRFReport,
  type TestExecution,
  type TestResult,
  type TestStatus,
} from '@warden/core';

/**
 * Maps a CTRF test status onto the Warden `TestStatus` enum. CTRF's `pending` roughly
 * corresponds to a test that was started but never finished, which we treat as `BLOCKED`;
 * `other` (a catch-all in CTRF) is treated as `SKIP` since there is no better analog.
 */
const CTRF_STATUS_MAP: Record<CTRFReport['results']['tests'][number]['status'], TestStatus> = {
  passed: 'PASS',
  failed: 'FAIL',
  skipped: 'SKIP',
  pending: 'BLOCKED',
  other: 'SKIP',
};

/** Options for {@link ctrfToExecution}. */
export interface CtrfToExecutionOptions {
  /** The `TestPlan` this execution belongs to. Defaults to `'ad-hoc'`. */
  testPlanId?: string;
  /** What triggered this run. Defaults to `'manual'`. */
  triggerType?: TestExecution['triggerType'];
  /** A ref describing the trigger (grep tag, PR number, ...). Defaults to `'local'`. */
  triggerRef?: string;
  /** Defaults to `'ci'`. */
  environment?: string;
}

/**
 * Converts a CTRF report (as produced by the runner) into a Warden `TestExecution` so it can
 * be handed to a `Reporter`, whose contract is fixed to `report(execution, ctx)`. Each CTRF
 * test becomes one `TestResult`; the test's stable id is derived from its file path + name via
 * `contentId` so the same test always maps to the same `testCaseId` across runs.
 */
export function ctrfToExecution(
  report: CTRFReport,
  opts: CtrfToExecutionOptions = {},
): TestExecution {
  const results: TestResult[] = report.results.tests.map((test) => {
    const identity = test.filePath ? `${test.filePath}::${test.name}` : test.name;
    const result: TestResult = {
      testCaseId: contentId('TC', identity),
      status: CTRF_STATUS_MAP[test.status],
      duration: test.duration,
      retries: 0,
      flakeFlag: false,
      artifacts: [],
    };
    if (test.message !== undefined) {
      result.errorMessage = test.message;
    }
    return result;
  });

  return {
    id: contentId('EXEC', `${opts.triggerRef ?? 'local'}:${report.results.summary.start}`),
    testPlanId: opts.testPlanId ?? 'ad-hoc',
    triggerType: opts.triggerType ?? 'manual',
    triggerRef: opts.triggerRef ?? 'local',
    environment: opts.environment ?? 'ci',
    startedAt: new Date(report.results.summary.start),
    completedAt: new Date(report.results.summary.stop),
    results,
  };
}
