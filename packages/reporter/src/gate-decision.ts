import type { GateDecision, TestExecution } from '@warden/core';

/**
 * Derives a `GateDecision` from an execution's results alone. Used by reporters whose
 * `report(execution, ctx)` signature (fixed by the `Reporter` contract) doesn't carry an
 * externally-computed gate decision, so they must derive a reasonable one themselves.
 */
export function computeGateDecision(execution: TestExecution): GateDecision {
  // Zero results is not a pass — a silently-empty or unparseable report must never read as a
  // confident green. WARN surfaces the anomaly without hard-blocking legitimate no-test changes.
  if (execution.results.length === 0) {
    return { decision: 'WARN', reason: 'no tests ran' };
  }

  const failed = execution.results.filter((r) => r.status === 'FAIL').length;
  if (failed > 0) {
    return { decision: 'BLOCK', reason: `${failed} test(s) failed` };
  }

  const flaky = execution.results.filter((r) => r.status === 'FLAKY').length;
  if (flaky > 0) {
    return { decision: 'WARN', reason: `${flaky} test(s) flaky` };
  }

  return { decision: 'PASS', reason: 'All tests passed' };
}
