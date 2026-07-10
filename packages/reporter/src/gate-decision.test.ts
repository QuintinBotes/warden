import { describe, expect, it } from 'vitest';
import { fixtureExecution } from '@warden/core/testing';
import { computeGateDecision } from './gate-decision.js';

describe('computeGateDecision', () => {
  it('returns PASS when every result passed', () => {
    const execution = fixtureExecution();

    expect(computeGateDecision(execution)).toEqual({
      decision: 'PASS',
      reason: 'All tests passed',
    });
  });

  it('returns BLOCK when any result failed', () => {
    const execution = fixtureExecution({
      results: [
        { testCaseId: 'TC-1', status: 'PASS', duration: 10, retries: 0, flakeFlag: false },
        { testCaseId: 'TC-2', status: 'FAIL', duration: 10, retries: 0, flakeFlag: false },
      ],
    });

    const gate = computeGateDecision(execution);
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toContain('1');
  });

  it('returns WARN when a result is flaky but nothing failed', () => {
    const execution = fixtureExecution({
      results: [{ testCaseId: 'TC-1', status: 'FLAKY', duration: 10, retries: 2, flakeFlag: true }],
    });

    expect(computeGateDecision(execution).decision).toBe('WARN');
  });

  it('does not claim "All tests passed" when zero tests ran — WARNs with an honest reason', () => {
    const execution = fixtureExecution({ results: [] });

    const gate = computeGateDecision(execution);
    expect(gate.decision).toBe('WARN');
    expect(gate.reason).toMatch(/no tests ran/i);
  });

  it('WARNs (not PASS) when tests ran but none actually passed — all skipped or blocked', () => {
    const execution = fixtureExecution({
      results: [
        { testCaseId: 'TC-1', status: 'SKIP', duration: 0, retries: 0, flakeFlag: false },
        { testCaseId: 'TC-2', status: 'BLOCKED', duration: 0, retries: 0, flakeFlag: false },
      ],
    });

    const gate = computeGateDecision(execution);
    expect(gate.decision).toBe('WARN');
    expect(gate.reason).toMatch(/no tests passed/i);
  });

  it('still PASSes when at least one test passed and the rest were skipped', () => {
    const execution = fixtureExecution({
      results: [
        { testCaseId: 'TC-1', status: 'PASS', duration: 10, retries: 0, flakeFlag: false },
        { testCaseId: 'TC-2', status: 'SKIP', duration: 0, retries: 0, flakeFlag: false },
      ],
    });

    expect(computeGateDecision(execution).decision).toBe('PASS');
  });
});
