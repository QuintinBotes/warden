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

  // Tests ran but nothing actually passed — every result was skipped or blocked (a blocked test
  // started but never finished). "Nothing passed" must never read as "All tests passed".
  const passed = execution.results.filter((r) => r.status === 'PASS').length;
  if (passed === 0) {
    const skipped = execution.results.filter((r) => r.status === 'SKIP').length;
    const blocked = execution.results.filter((r) => r.status === 'BLOCKED').length;
    return { decision: 'WARN', reason: `no tests passed (${skipped} skipped, ${blocked} blocked)` };
  }

  return { decision: 'PASS', reason: 'All tests passed' };
}
