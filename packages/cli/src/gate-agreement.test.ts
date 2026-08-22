import { describe, expect, it } from 'vitest';
import { defineConfig } from '@warden/core';
import type { Priority, TestResult, TestStatus } from '@warden/core';
import { fixtureExecution } from '@warden/core/testing';
import { evaluateExitCriteria } from '@warden/orchestrator';
import { computeGateDecision } from '@warden/reporter';

const cfg = defineConfig();

function result(status: TestStatus, i: number): TestResult {
  return {
    testCaseId: `TC-${i}`,
    status,
    duration: 1,
    retries: 0,
    flakeFlag: false,
    artifacts: [],
  };
}

/**
 * Warden had two gates. `evaluateExitCriteria` read the configured `gates` thresholds and was
 * called by nothing outside its own tests; `computeGateDecision` produced every verdict the
 * product actually posts and took no config at all. This asserts the disagreement is gone on
 * the case that made it visible — a run that skipped nearly everything.
 */
describe('the configured gate and the gate the product posts', () => {
  it('agree that a mostly-skipped run is blocked, with the same reason', () => {
    const statuses: TestStatus[] = ['PASS', ...Array.from({ length: 9 }, () => 'SKIP' as const)];

    const configured = evaluateExitCriteria(
      statuses.map((status) => ({ status, priority: 'P1' as Priority })),
      cfg,
    );
    const posted = computeGateDecision(
      fixtureExecution({ results: statuses.map(result) }),
      cfg.gates,
    );

    expect(configured.decision).toBe('BLOCK');
    expect(posted.decision).toBe(configured.decision);
    expect(posted.reason).toBe(configured.reason);
  });

  it('agree when a lowered threshold lets the same run through', () => {
    const relaxed = defineConfig({ gates: { blockOnPassRateBelowPercent: 10 } });
    const statuses: TestStatus[] = ['PASS', ...Array.from({ length: 9 }, () => 'SKIP' as const)];

    const configured = evaluateExitCriteria(
      statuses.map((status) => ({ status, priority: 'P3' as Priority })),
      relaxed,
    );
    const posted = computeGateDecision(
      fixtureExecution({ results: statuses.map(result) }),
      relaxed.gates,
    );

    expect(configured.decision).toBe('PASS');
    expect(posted.decision).toBe('PASS');
  });
});
