import { describe, expect, it } from 'vitest';
import { defineConfig } from '@warden/core';
import { fixtureExecution } from '@warden/core/testing';
import { computeGateDecision, resolveGateDecision } from './gate-decision.js';

const cfg = defineConfig();

describe('computeGateDecision', () => {
  it('returns PASS when every result passed', () => {
    const execution = fixtureExecution();

    expect(computeGateDecision(execution, cfg.gates)).toEqual({
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

    const gate = computeGateDecision(execution, cfg.gates);
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toContain('1');
  });

  it('returns WARN when a result is flaky but nothing failed', () => {
    const execution = fixtureExecution({
      results: [{ testCaseId: 'TC-1', status: 'FLAKY', duration: 10, retries: 2, flakeFlag: true }],
    });

    expect(computeGateDecision(execution, cfg.gates).decision).toBe('WARN');
  });

  it('does not claim "All tests passed" when zero tests ran — WARNs with an honest reason', () => {
    const execution = fixtureExecution({ results: [] });

    const gate = computeGateDecision(execution, cfg.gates);
    expect(gate.decision).toBe('WARN');
    expect(gate.reason).toMatch(/no tests ran/i);
  });

  it('never PASSes when tests ran but none actually passed — everything was skipped', () => {
    const execution = fixtureExecution({
      results: [
        { testCaseId: 'TC-1', status: 'SKIP', duration: 0, retries: 0, flakeFlag: false },
        { testCaseId: 'TC-2', status: 'SKIP', duration: 0, retries: 0, flakeFlag: false },
      ],
    });

    // 0% clears no threshold the project could have set above zero, so under any normal config
    // this is the configured pass-rate block.
    const gate = computeGateDecision(execution, cfg.gates);
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toMatch(/pass rate 0\.0% is below the required 90%/);

    // With the pass-rate gate switched off it is still not a pass: the floor below it holds.
    const off = defineConfig({ gates: { blockOnPassRateBelowPercent: 0 } });
    const floor = computeGateDecision(execution, off.gates);
    expect(floor.decision).toBe('WARN');
    expect(floor.reason).toMatch(/no tests passed/i);
  });

  it('BLOCKs (not WARNs) when nothing passed and a test did not finish', () => {
    const execution = fixtureExecution({
      results: [
        { testCaseId: 'TC-1', status: 'SKIP', duration: 0, retries: 0, flakeFlag: false },
        { testCaseId: 'TC-2', status: 'BLOCKED', duration: 0, retries: 0, flakeFlag: false },
      ],
    });

    // An unfinished test is reported ahead of the pass rate: "did not finish" is the reason,
    // and it holds even with the pass-rate gate switched off.
    const gate = computeGateDecision(execution, cfg.gates);
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toMatch(/did not finish/i);

    const off = defineConfig({ gates: { blockOnPassRateBelowPercent: 0 } });
    expect(computeGateDecision(execution, off.gates).decision).toBe('BLOCK');
  });

  it('BLOCKs when a test never finished, even though every other test passed', () => {
    // A run cut short (--max-failures, global timeout, SIGINT) leaves unfinished tests BLOCKED.
    // Their result is unknown, so one surviving pass must not carry the gate.
    const execution = fixtureExecution({
      results: [
        { testCaseId: 'TC-1', status: 'PASS', duration: 10, retries: 0, flakeFlag: false },
        { testCaseId: 'TC-2', status: 'BLOCKED', duration: 0, retries: 0, flakeFlag: false },
      ],
    });

    const gate = computeGateDecision(execution, cfg.gates);
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toMatch(/did not finish/i);
  });

  it('still PASSes when a skip leaves the pass rate above the configured threshold', () => {
    // A skipped test is not by itself a reason to block: 19 of 20 passed is 95%, over the
    // default 90%. What blocks is a rate the project's own `gates` say is too low.
    const execution = fixtureExecution({
      results: [
        ...Array.from({ length: 19 }, (_, i) => ({
          testCaseId: `TC-${i}`,
          status: 'PASS' as const,
          duration: 10,
          retries: 0,
          flakeFlag: false,
        })),
        { testCaseId: 'TC-skip', status: 'SKIP', duration: 0, retries: 0, flakeFlag: false },
      ],
    });

    expect(computeGateDecision(execution, cfg.gates).decision).toBe('PASS');
  });

  it('BLOCKs when the configured pass-rate gate is not met — a mostly-skipped run is not a pass', () => {
    // The defect this asserts against: `gates.blockOnPassRateBelowPercent` is documented, shipped
    // in the `warden init` template, and was read by nothing on a production path. One test passed
    // and nine were skipped — 10%, far under the default 90% — and the gate said "All tests passed".
    const execution = fixtureExecution({
      results: [
        { testCaseId: 'TC-1', status: 'PASS', duration: 10, retries: 0, flakeFlag: false },
        ...Array.from({ length: 9 }, (_, i) => ({
          testCaseId: `TC-skip-${i}`,
          status: 'SKIP' as const,
          duration: 0,
          retries: 0,
          flakeFlag: false,
        })),
      ],
    });

    const gate = computeGateDecision(execution, cfg.gates);
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toMatch(/pass rate 10\.0% is below the required 90%/);
  });

  it('honours a lowered blockOnPassRateBelowPercent instead of a fixed rule', () => {
    const relaxed = defineConfig({ gates: { blockOnPassRateBelowPercent: 10 } });
    const execution = fixtureExecution({
      results: [
        { testCaseId: 'TC-1', status: 'PASS', duration: 10, retries: 0, flakeFlag: false },
        ...Array.from({ length: 9 }, (_, i) => ({
          testCaseId: `TC-skip-${i}`,
          status: 'SKIP' as const,
          duration: 0,
          retries: 0,
          flakeFlag: false,
        })),
      ],
    });

    expect(computeGateDecision(execution, relaxed.gates).decision).toBe('PASS');
  });

  it('honours a raised blockOnPassRateBelowPercent — a run the default would pass is blocked', () => {
    const strict = defineConfig({ gates: { blockOnPassRateBelowPercent: 100 } });
    const execution = fixtureExecution({
      results: [
        ...Array.from({ length: 19 }, (_, i) => ({
          testCaseId: `TC-${i}`,
          status: 'PASS' as const,
          duration: 10,
          retries: 0,
          flakeFlag: false,
        })),
        { testCaseId: 'TC-skip', status: 'SKIP', duration: 0, retries: 0, flakeFlag: false },
      ],
    });

    expect(computeGateDecision(execution, cfg.gates).decision).toBe('PASS');
    expect(computeGateDecision(execution, strict.gates).decision).toBe('BLOCK');
  });
});

describe('resolveGateDecision', () => {
  it('publishes the folded-in gate the caller supplied, not the tests-only derivation', () => {
    const execution = fixtureExecution({
      results: [{ testCaseId: 'TC-1', status: 'PASS', duration: 10, retries: 0, flakeFlag: false }],
    });
    expect(computeGateDecision(execution, defineConfig().gates).decision).toBe('PASS');

    const gate = resolveGateDecision(execution, {
      config: defineConfig(),
      artifactsDir: '/tmp/artifacts',
      gate: { decision: 'BLOCK', reason: '1 critical a11y violation' },
    });

    expect(gate).toEqual({ decision: 'BLOCK', reason: '1 critical a11y violation' });
  });

  it('falls back to the tests-only derivation when the context carries no gate', () => {
    const execution = fixtureExecution({
      results: [{ testCaseId: 'TC-1', status: 'FAIL', duration: 10, retries: 0, flakeFlag: false }],
    });

    const gate = resolveGateDecision(execution, {
      config: defineConfig(),
      artifactsDir: '/tmp/artifacts',
    });

    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toContain('1 test(s) failed');
  });
});
