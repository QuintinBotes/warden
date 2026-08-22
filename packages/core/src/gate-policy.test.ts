import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GATE_POLICY,
  evaluateGate,
  readPriority,
  type GateableResult,
} from './gate-policy';
import type { Priority, TestStatus } from './schema';

function r(status: TestStatus, priority?: Priority): GateableResult {
  return priority ? { status, priority } : { status };
}

const policy = (over: Partial<typeof DEFAULT_GATE_POLICY> = {}) => ({
  ...DEFAULT_GATE_POLICY,
  ...over,
});

describe('evaluateGate', () => {
  it('blocks any failing test, whatever the pass-rate floor is set to', () => {
    // The floor asks "did enough of this run produce an answer"; a red test produced one.
    // Lowering the floor buys tolerance for skips, never for failures.
    const results = [...Array.from({ length: 9 }, () => r('PASS')), r('FAIL')];

    for (const floor of [100, 90, 50, 0]) {
      expect(evaluateGate(results, policy({ blockOnPassRateBelowPercent: floor }))).toEqual({
        decision: 'BLOCK',
        reason: '1 test(s) failed',
      });
    }
  });

  it('ships a default that reads as a floor on measurement, not a failure allowance', () => {
    expect(DEFAULT_GATE_POLICY.blockOnPassRateBelowPercent).toBe(90);
  });

  it('blocks below the floor and names the threshold that was missed', () => {
    // No failures here — this is the floor's own rule: three of four results produced no
    // answer at all, so the run measured too little to clear the bar the project set.
    const results = [r('PASS'), r('SKIP'), r('SKIP'), r('SKIP')];

    const decision = evaluateGate(results, policy({ blockOnPassRateBelowPercent: 90 }));
    expect(decision.decision).toBe('BLOCK');
    expect(decision.reason).toMatch(/pass rate 25\.0% is below the required 90%/);
  });

  it('blocks a P1 failure on the critical rule, ahead of the plain failure rule', () => {
    // Both rules block; which one fires is what the reason has to say, because
    // `blockOnCritical: false` is a real setting whose effect must be visible.
    const results = [...Array.from({ length: 9 }, () => r('PASS')), r('FAIL', 'P1')];

    const loose = policy({ blockOnPassRateBelowPercent: 50 });
    const critical = evaluateGate(results, loose);
    expect(critical.decision).toBe('BLOCK');
    expect(critical.reason).toMatch(/critical \(P1\)/);

    const off = evaluateGate(results, { ...loose, blockOnCritical: false });
    expect(off.decision).toBe('BLOCK');
    expect(off.reason).toBe('1 test(s) failed');
  });

  it('reports the P2 threshold only once P2 failures exceed warnOnHighCount', () => {
    const loose = policy({ blockOnPassRateBelowPercent: 50, warnOnHighCount: 2 });
    const pad = Array.from({ length: 30 }, () => r('PASS'));

    const two = evaluateGate([...pad, r('FAIL', 'P2'), r('FAIL', 'P2')], loose);
    expect(two.decision).toBe('BLOCK');
    expect(two.reason).toBe('2 test(s) failed');

    const three = evaluateGate([...pad, r('FAIL', 'P2'), r('FAIL', 'P2'), r('FAIL', 'P2')], loose);
    expect(three.decision).toBe('BLOCK');
    expect(three.reason).toMatch(/P2.*above the threshold of 2/);
  });

  it('counts a skip against the pass rate — a run that measured little is not a pass', () => {
    // 19 of 20 is 95%, over the default 90: one skip is not by itself a reason to block.
    expect(
      evaluateGate([...Array.from({ length: 19 }, () => r('PASS')), r('SKIP')], DEFAULT_GATE_POLICY)
        .decision,
    ).toBe('PASS');

    // 1 of 10 is 10%. The tests that ran are not the whole answer.
    const mostlySkipped = evaluateGate(
      [r('PASS'), ...Array.from({ length: 9 }, () => r('SKIP'))],
      DEFAULT_GATE_POLICY,
    );
    expect(mostlySkipped.decision).toBe('BLOCK');
    expect(mostlySkipped.reason).toMatch(/pass rate 10\.0% is below the required 90%/);
  });

  it('counts a flaky result as green for the rate and warns about it separately', () => {
    const decision = evaluateGate([r('PASS'), r('FLAKY')], DEFAULT_GATE_POLICY);
    expect(decision.decision).toBe('WARN');
    expect(decision.reason).toMatch(/flaky/);
  });

  it('never reads an empty or all-skipped run as green', () => {
    expect(evaluateGate([], DEFAULT_GATE_POLICY)).toEqual({
      decision: 'WARN',
      reason: 'no tests ran',
    });

    // Under the default floor an all-skipped run blocks outright. With the floor switched
    // off it is still not a pass — the "nothing passed" rule underneath it holds.
    expect(evaluateGate([r('SKIP'), r('SKIP')], DEFAULT_GATE_POLICY).decision).toBe('BLOCK');
    const off = evaluateGate([r('SKIP'), r('SKIP')], policy({ blockOnPassRateBelowPercent: 0 }));
    expect(off.decision).toBe('WARN');
    expect(off.reason).toMatch(/no tests passed/);
  });

  it('blocks on a test that never finished, whatever the configured thresholds say', () => {
    // An unfinished test produced no verdict, so no `gates` threshold covers it: the run is a
    // partial answer and reading it as a whole one is the failure this gate exists to prevent.
    for (const p of [
      DEFAULT_GATE_POLICY,
      policy({ blockOnCritical: false, blockOnPassRateBelowPercent: 0 }),
    ]) {
      const decision = evaluateGate([r('PASS'), r('BLOCKED')], p);
      expect(decision.decision).toBe('BLOCK');
      expect(decision.reason).toMatch(/did not finish/);
    }
  });

  it('ignores priority rules for results the runner never marked', () => {
    // An unmarked failure must not be treated as P1: `blockOnCritical` would then fire on
    // every suite that marks nothing, which is most of them. It still blocks — as a plain
    // failure — but not on the critical rule.
    const decision = evaluateGate(
      [...Array.from({ length: 9 }, () => r('PASS')), r('FAIL')],
      policy({ blockOnPassRateBelowPercent: 50 }),
    );
    expect(decision.reason).toBe('1 test(s) failed');
    expect(decision.reason).not.toMatch(/critical/);
  });
});

describe('readPriority', () => {
  it('reads CTRF extra.priority', () => {
    expect(readPriority({ extra: { priority: 'P1' } })).toBe('P1');
  });

  it('reads a @P2-style tag, which is how a Playwright suite marks criticality', () => {
    expect(readPriority({ tags: ['@regression', '@p2'] })).toBe('P2');
    expect(readPriority({ tags: ['P3'] })).toBe('P3');
  });

  it('returns undefined for an unmarked test rather than guessing one', () => {
    expect(readPriority({})).toBeUndefined();
    expect(readPriority({ tags: ['@smoke'], extra: { priority: 'urgent' } })).toBeUndefined();
  });
});
