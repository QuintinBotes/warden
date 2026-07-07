import {
  CTRFReportSchema,
  type CTRFReport,
  type CTRFTest,
  type TestExecution,
  type TestStatus,
} from '@warden/core';

/** Options for {@link executionToCtrf}. */
export interface ExecutionToCtrfOptions {
  /** The tool name recorded in the CTRF report. Defaults to `'warden'`. */
  toolName?: string;
}

/**
 * Maps a Warden `TestStatus` onto the CTRF status vocabulary.
 *
 * `BLOCKED` becomes `pending` (the test never ran) and `FLAKY` becomes `passed`
 * (it ultimately passed after retries) — flaky tests are additionally tagged
 * `'flaky'` in the resulting CTRF test so downstream consumers can distinguish them.
 */
function mapStatus(status: TestStatus): CTRFTest['status'] {
  switch (status) {
    case 'PASS':
      return 'passed';
    case 'FAIL':
      return 'failed';
    case 'SKIP':
      return 'skipped';
    case 'BLOCKED':
      return 'pending';
    case 'FLAKY':
      return 'passed';
    default:
      return 'other';
  }
}

/** Converts a Warden `TestExecution` into a CTRFReportSchema-valid report. */
export function executionToCtrf(
  execution: TestExecution,
  opts: ExecutionToCtrfOptions = {},
): CTRFReport {
  const tests: CTRFTest[] = execution.results.map((result) => {
    const extra: Record<string, unknown> = {
      retries: result.retries,
      flakeFlag: result.flakeFlag,
    };
    if (result.screenshotPath) extra.screenshotPath = result.screenshotPath;
    if (result.videoPath) extra.videoPath = result.videoPath;
    if (result.tracePath) extra.tracePath = result.tracePath;
    if (result.artifacts.length > 0) extra.artifacts = result.artifacts;

    return {
      name: result.testCaseId,
      status: mapStatus(result.status),
      duration: result.duration,
      message: result.errorMessage,
      tags: result.flakeFlag ? ['flaky'] : undefined,
      extra,
    };
  });

  const summary = tests.reduce(
    (acc, test) => {
      acc.tests += 1;
      acc[test.status] += 1;
      return acc;
    },
    { tests: 0, passed: 0, failed: 0, skipped: 0, pending: 0, other: 0 },
  );

  const start = execution.startedAt.getTime();
  const stop = execution.completedAt ? execution.completedAt.getTime() : start;

  return CTRFReportSchema.parse({
    results: {
      tool: { name: opts.toolName ?? 'warden' },
      summary: { ...summary, start, stop },
      tests,
    },
  });
}
