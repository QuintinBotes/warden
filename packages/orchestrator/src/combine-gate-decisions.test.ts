import { describe, expect, it } from 'vitest';
import type { GateDecision } from '@warden/core';
import { combineGateDecisions } from './combine-gate-decisions';

function d(decision: GateDecision['decision'], reason: string): GateDecision {
  return { decision, reason };
}

describe('combineGateDecisions', () => {
  it('returns PASS for an empty list', () => {
    expect(combineGateDecisions([])).toEqual({ decision: 'PASS', reason: expect.any(String) });
  });

  it('returns PASS when every decision is PASS', () => {
    const result = combineGateDecisions([d('PASS', 'ok 1'), d('PASS', 'ok 2')]);
    expect(result.decision).toBe('PASS');
  });

  it('combines [PASS, WARN, PASS] into WARN with the WARN reason', () => {
    const result = combineGateDecisions([
      d('PASS', 'ok'),
      d('WARN', 'moderate a11y issue'),
      d('PASS', 'ok'),
    ]);
    expect(result.decision).toBe('WARN');
    expect(result.reason).toBe('moderate a11y issue');
  });

  it('combines [WARN, BLOCK] into BLOCK with both reasons joined', () => {
    const result = combineGateDecisions([
      d('WARN', 'near-budget lcp'),
      d('BLOCK', 'critical a11y violation'),
    ]);
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toContain('near-budget lcp');
    expect(result.reason).toContain('critical a11y violation');
  });

  it('BLOCK wins over WARN and PASS regardless of order', () => {
    const result = combineGateDecisions([d('BLOCK', 'x'), d('PASS', 'y'), d('WARN', 'z')]);
    expect(result.decision).toBe('BLOCK');
  });

  it('a single BLOCK decision passes through with its own reason', () => {
    const result = combineGateDecisions([d('BLOCK', 'only reason')]);
    expect(result).toEqual({ decision: 'BLOCK', reason: 'only reason' });
  });
});
