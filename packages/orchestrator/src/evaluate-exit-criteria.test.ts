import { describe, it, expect } from 'vitest';
import { defineConfig } from '@warden/core';
import type { Priority, TestStatus } from '@warden/core';
import { evaluateExitCriteria } from './index';

const cfg = defineConfig();

function r(status: TestStatus, priority: Priority): { status: TestStatus; priority: Priority } {
  return { status, priority };
}

describe('evaluateExitCriteria', () => {
  it('blocks on any critical (P1) failure when blockOnCritical is set', () => {
    const decision = evaluateExitCriteria([r('FAIL', 'P1'), r('PASS', 'P2')], cfg);
    expect(decision.decision).toBe('BLOCK');
    expect(decision.reason).toMatch(/P1/);
  });

  it('stops reporting a P1 failure as critical when blockOnCritical is disabled', () => {
    // Turning the rule off does not let the failure through — any failure blocks — but the
    // reason must stop naming the critical rule, or the setting would have no visible effect.
    const relaxed = defineConfig({
      gates: { blockOnCritical: false, blockOnPassRateBelowPercent: 90 },
    });
    const results = [r('FAIL', 'P1'), ...Array.from({ length: 19 }, () => r('PASS', 'P3'))];
    const decision = evaluateExitCriteria(results, relaxed);
    expect(decision.decision).toBe('BLOCK');
    expect(decision.reason).not.toMatch(/P1/);
  });

  it('blocks when P2 failures exceed warnOnHighCount', () => {
    const results = [
      r('FAIL', 'P2'),
      r('FAIL', 'P2'),
      r('FAIL', 'P2'),
      ...Array.from({ length: 100 }, () => r('PASS', 'P3')),
    ];
    const decision = evaluateExitCriteria(results, cfg);
    expect(decision.decision).toBe('BLOCK');
    expect(decision.reason).toMatch(/P2/);
  });

  it('blocks when the pass rate falls below the configured threshold', () => {
    // Skips, not failures: a failing test blocks on its own rule, which would hide whether the
    // pass-rate floor did anything. One green result in four is 25%.
    const strict = defineConfig({ gates: { blockOnPassRateBelowPercent: 90 } });
    const results = [r('PASS', 'P3'), ...Array.from({ length: 3 }, () => r('SKIP', 'P3'))];
    const decision = evaluateExitCriteria(results, strict);
    expect(decision.decision).toBe('BLOCK');
    expect(decision.reason).toMatch(/pass rate/i);
    expect(decision.reason).toMatch(/90%/);
  });

  it('does not report the P2 threshold for a single P2 failure under warnOnHighCount', () => {
    // The failure still blocks — one red test always does — but on the plain failure rule,
    // not the P2 threshold rule, which needs more than `warnOnHighCount` of them.
    const relaxed = defineConfig({ gates: { blockOnPassRateBelowPercent: 90 } });
    const results = [r('FAIL', 'P2'), ...Array.from({ length: 20 }, () => r('PASS', 'P3'))];
    const decision = evaluateExitCriteria(results, relaxed);
    expect(decision.decision).toBe('BLOCK');
    expect(decision.reason).toBe('1 test(s) failed');
  });

  it('passes when all exit criteria are met', () => {
    const decision = evaluateExitCriteria([r('PASS', 'P1'), r('PASS', 'P2')], cfg);
    expect(decision.decision).toBe('PASS');
  });

  it('WARNs on an empty result set — no tests ran is not a pass', () => {
    const decision = evaluateExitCriteria([], cfg);
    expect(decision.decision).toBe('WARN');
    expect(decision.reason).toMatch(/no tests ran/i);
  });
});
