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

  it('does not block on a critical failure when blockOnCritical is disabled', () => {
    const relaxed = defineConfig({ gates: { blockOnCritical: false } });
    // 1 P1 fail out of 20 keeps the pass rate above the default 90% threshold.
    const results = [r('FAIL', 'P1'), ...Array.from({ length: 19 }, () => r('PASS', 'P3'))];
    const decision = evaluateExitCriteria(results, relaxed);
    expect(decision.decision).not.toBe('BLOCK');
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
    const decision = evaluateExitCriteria([r('FAIL', 'P3'), r('PASS', 'P3')], cfg);
    expect(decision.decision).toBe('BLOCK');
    expect(decision.reason).toMatch(/pass rate/i);
  });

  it('warns on a P2 failure that does not exceed the threshold', () => {
    const results = [r('FAIL', 'P2'), ...Array.from({ length: 20 }, () => r('PASS', 'P3'))];
    const decision = evaluateExitCriteria(results, cfg);
    expect(decision.decision).toBe('WARN');
    expect(decision.reason).toMatch(/P2/);
  });

  it('passes when all exit criteria are met', () => {
    const decision = evaluateExitCriteria([r('PASS', 'P1'), r('PASS', 'P2')], cfg);
    expect(decision.decision).toBe('PASS');
  });

  it('passes on an empty result set', () => {
    const decision = evaluateExitCriteria([], cfg);
    expect(decision.decision).toBe('PASS');
  });
});
