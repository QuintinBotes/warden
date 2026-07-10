import type { GateDecision, Priority, TestStatus, WardenConfig } from '@warden/core';

/**
 * Evaluate the quality gate for a set of results, returning a PASS / WARN / BLOCK decision
 * with a human-readable reason explaining which rule fired. Rules are checked in priority
 * order so the most severe blocking reason wins.
 */
export function evaluateExitCriteria(
  results: Array<{ status: TestStatus; priority: Priority }>,
  cfg: WardenConfig,
): GateDecision {
  const total = results.length;

  // No results is not a pass — the pass-rate math below would otherwise manufacture 100% for
  // an empty set (0/0). "No tests ran" surfaces the anomaly without hard-blocking.
  if (total === 0) {
    return { decision: 'WARN', reason: 'no tests ran' };
  }

  const passCount = results.filter((r) => r.status === 'PASS').length;
  const p1Fails = results.filter((r) => r.status === 'FAIL' && r.priority === 'P1').length;
  const p2Fails = results.filter((r) => r.status === 'FAIL' && r.priority === 'P2').length;
  const passRate = total === 0 ? 1 : passCount / total;
  const passRatePercent = passRate * 100;

  if (p1Fails > 0 && cfg.gates.blockOnCritical) {
    return {
      decision: 'BLOCK',
      reason: `Blocked: ${p1Fails} critical (P1) test failure(s).`,
    };
  }

  if (p2Fails > cfg.gates.warnOnHighCount) {
    return {
      decision: 'BLOCK',
      reason: `Blocked: ${p2Fails} high-priority (P2) failure(s) exceed the threshold of ${cfg.gates.warnOnHighCount}.`,
    };
  }

  if (passRatePercent < cfg.gates.blockOnPassRateBelowPercent) {
    return {
      decision: 'BLOCK',
      reason: `Blocked: pass rate ${passRatePercent.toFixed(1)}% is below the required ${cfg.gates.blockOnPassRateBelowPercent}%.`,
    };
  }

  if (p2Fails > 0) {
    return {
      decision: 'WARN',
      reason: `Warning: ${p2Fails} high-priority (P2) failure(s).`,
    };
  }

  return {
    decision: 'PASS',
    reason: `All exit criteria met: ${passCount}/${total} passed.`,
  };
}
