import type { SharedRunSummary, TestExecution, TestStatus } from '@warden/core';

/** One test result as exposed in the public run view: no error stacks, no artifact paths. */
export interface RedactedResult {
  name: string;
  status: TestStatus;
  duration: number;
}

/** The public run view: a summary plus a redacted per-test list safe to serve on a share link. */
export interface RunView {
  summary: SharedRunSummary;
  results: RedactedResult[];
}

/** Reduce an execution to counts by status, serializing `startedAt` to an ISO string. */
export function toSharedRunSummary(execution: TestExecution): SharedRunSummary {
  let passed = 0;
  let failed = 0;
  let flaky = 0;
  for (const result of execution.results) {
    if (result.status === 'PASS') passed += 1;
    else if (result.status === 'FAIL') failed += 1;
    else if (result.status === 'FLAKY') flaky += 1;
  }
  return {
    executionId: execution.id,
    triggerRef: execution.triggerRef,
    environment: execution.environment,
    startedAt: execution.startedAt.toISOString(),
    total: execution.results.length,
    passed,
    failed,
    flaky,
  };
}

/**
 * Build the public run view. Deliberately projects each result down to `name`, `status`, and
 * `duration` only — `errorMessage`, screenshot/video/trace paths, and artifacts stay internal
 * and never reach the shared link.
 */
export function buildRunView(execution: TestExecution): RunView {
  return {
    summary: toSharedRunSummary(execution),
    results: execution.results.map((result) => ({
      name: result.testCaseId,
      status: result.status,
      duration: result.duration,
    })),
  };
}
