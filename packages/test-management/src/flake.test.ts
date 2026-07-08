import { describe, expect, it } from 'vitest';
import type { CTRFReport, CTRFTest, TestResult } from '@warden/core';
import {
  computeFlakeImpact,
  computeFlakeRate,
  computeMttrToDeflake,
  reconcileRetries,
  selectRetryCandidates,
  shouldQuarantine,
} from './flake.js';

function makeResult(status: TestResult['status']): TestResult {
  return {
    testCaseId: 'TC-001',
    status,
    duration: 1,
    retries: 0,
    flakeFlag: false,
    artifacts: [],
  };
}

function ctrf(tests: CTRFTest[], start = 0, stop = 0): CTRFReport {
  return {
    results: {
      tool: { name: 'playwright' },
      summary: {
        tests: tests.length,
        passed: tests.filter((t) => t.status === 'passed').length,
        failed: tests.filter((t) => t.status === 'failed').length,
        skipped: tests.filter((t) => t.status === 'skipped').length,
        pending: 0,
        other: 0,
        start,
        stop,
      },
      tests,
    },
  };
}

describe('computeFlakeRate', () => {
  it('returns 0 for an empty history', () => {
    expect(computeFlakeRate([])).toBe(0);
  });

  it('returns the fraction of FAIL results', () => {
    const history = [
      makeResult('PASS'),
      makeResult('FAIL'),
      makeResult('PASS'),
      makeResult('FAIL'),
    ];

    expect(computeFlakeRate(history)).toBe(0.5);
  });

  it('returns 0 when nothing failed', () => {
    expect(computeFlakeRate([makeResult('PASS'), makeResult('PASS')])).toBe(0);
  });

  it('returns 1 when everything failed', () => {
    expect(computeFlakeRate([makeResult('FAIL'), makeResult('FAIL')])).toBe(1);
  });
});

describe('shouldQuarantine', () => {
  it('is false at or below the lower threshold', () => {
    expect(shouldQuarantine(0)).toBe(false);
    expect(shouldQuarantine(0.2)).toBe(false);
  });

  it('is true strictly between 0.2 and 0.8', () => {
    expect(shouldQuarantine(0.21)).toBe(true);
    expect(shouldQuarantine(0.5)).toBe(true);
    expect(shouldQuarantine(0.79)).toBe(true);
  });

  it('is false at or above the upper threshold', () => {
    expect(shouldQuarantine(0.8)).toBe(false);
    expect(shouldQuarantine(1)).toBe(false);
  });
});

describe('selectRetryCandidates', () => {
  it('returns every failing name when retryOnlyKnownFlaky is false', () => {
    const out = selectRetryCandidates(['a', 'b', 'c'], {
      retryOnlyKnownFlaky: false,
      knownFlaky: new Set(['b']),
    });
    expect(out).toEqual(['a', 'b', 'c']);
  });

  it('returns only known-flaky names when retryOnlyKnownFlaky is true', () => {
    const out = selectRetryCandidates(['a', 'b', 'c'], {
      retryOnlyKnownFlaky: true,
      knownFlaky: new Set(['b', 'c']),
    });
    expect(out).toEqual(['b', 'c']);
  });

  it('returns an empty list when nothing is known-flaky and the flag is set', () => {
    const out = selectRetryCandidates(['a', 'b'], {
      retryOnlyKnownFlaky: true,
      knownFlaky: new Set(),
    });
    expect(out).toEqual([]);
  });
});

describe('reconcileRetries', () => {
  it('flags a fail-then-pass test as flaky with the retry count', () => {
    const attempts = [
      ctrf([
        { name: 'login', status: 'passed', duration: 10 },
        { name: 'checkout', status: 'failed', duration: 20, message: 'boom' },
      ]),
      ctrf([{ name: 'checkout', status: 'passed', duration: 15 }]),
    ];

    const { report, meta } = reconcileRetries(attempts);

    const checkout = report.results.tests.find((t) => t.name === 'checkout');
    expect(checkout?.status).toBe('passed');
    expect(report.results.summary.passed).toBe(2);
    expect(report.results.summary.failed).toBe(0);
    expect(meta.get('checkout')).toEqual({ retries: 1, flakeFlag: true });
    expect(meta.get('login')).toEqual({ retries: 0, flakeFlag: false });
  });

  it('flags fail-fail-pass as flaky with two retries', () => {
    const attempts = [
      ctrf([{ name: 't', status: 'failed', duration: 1 }]),
      ctrf([{ name: 't', status: 'failed', duration: 1 }]),
      ctrf([{ name: 't', status: 'passed', duration: 1 }]),
    ];
    const { meta } = reconcileRetries(attempts);
    expect(meta.get('t')).toEqual({ retries: 2, flakeFlag: true });
  });

  it('keeps a test that fails every attempt as a non-flaky FAIL', () => {
    const attempts = [
      ctrf([{ name: 't', status: 'failed', duration: 1 }]),
      ctrf([{ name: 't', status: 'failed', duration: 1 }]),
    ];
    const { report, meta } = reconcileRetries(attempts);
    expect(report.results.tests[0]?.status).toBe('failed');
    expect(report.results.summary.failed).toBe(1);
    expect(meta.get('t')).toEqual({ retries: 1, flakeFlag: false });
  });

  it('keys by filePath::name so same-named tests in different files stay distinct', () => {
    const attempts = [
      ctrf([
        { name: 't', status: 'failed', duration: 1, filePath: 'a.spec.ts' },
        { name: 't', status: 'passed', duration: 1, filePath: 'b.spec.ts' },
      ]),
      ctrf([{ name: 't', status: 'passed', duration: 1, filePath: 'a.spec.ts' }]),
    ];
    const { meta } = reconcileRetries(attempts);
    expect(meta.get('a.spec.ts::t')).toEqual({ retries: 1, flakeFlag: true });
    expect(meta.get('b.spec.ts::t')).toEqual({ retries: 0, flakeFlag: false });
  });
});

describe('computeFlakeImpact', () => {
  it('sums retries, converts retry time to minutes, and counts blocks avoided', () => {
    const history: TestResult[] = [
      {
        testCaseId: 'TC-1',
        status: 'FLAKY',
        duration: 30000,
        retries: 2,
        flakeFlag: true,
        artifacts: [],
      },
      {
        testCaseId: 'TC-1',
        status: 'PASS',
        duration: 1000,
        retries: 0,
        flakeFlag: false,
        artifacts: [],
      },
      {
        testCaseId: 'TC-1',
        status: 'FAIL',
        duration: 60000,
        retries: 1,
        flakeFlag: false,
        artifacts: [],
      },
    ];
    const impact = computeFlakeImpact('TC-1', history);
    expect(impact.testCaseId).toBe('TC-1');
    expect(impact.reRunsCaused).toBe(3);
    // 2*30000 + 1*60000 = 120000ms = 2 minutes
    expect(impact.ciMinutesLost).toBe(2);
    // only the FLAKY (non-FAIL) result counts as a block avoided
    expect(impact.gateBlocksAvoided).toBe(1);
  });

  it('is all-zero for a clean history', () => {
    const impact = computeFlakeImpact('TC-2', [makeResult('PASS')]);
    expect(impact).toEqual({
      testCaseId: 'TC-2',
      reRunsCaused: 0,
      ciMinutesLost: 0,
      gateBlocksAvoided: 0,
    });
  });
});

describe('computeMttrToDeflake', () => {
  const base = new Date('2026-07-01T00:00:00.000Z');
  const at = (h: number) => new Date(base.getTime() + h * 3_600_000);

  it('returns the hours from first quarantine to the latest clear', () => {
    const events = [
      { testCaseId: 'TC-1', event: 'quarantined' as const, at: at(0) },
      { testCaseId: 'TC-1', event: 'cleared' as const, at: at(5) },
    ];
    expect(computeMttrToDeflake(events, 'TC-1')).toBe(5);
  });

  it('measures only the most recent episode', () => {
    const events = [
      { testCaseId: 'TC-1', event: 'quarantined' as const, at: at(0) },
      { testCaseId: 'TC-1', event: 'cleared' as const, at: at(2) },
      { testCaseId: 'TC-1', event: 'quarantined' as const, at: at(10) },
      { testCaseId: 'TC-1', event: 'cleared' as const, at: at(13) },
    ];
    expect(computeMttrToDeflake(events, 'TC-1')).toBe(3);
  });

  it('returns undefined for a test that was never quarantined', () => {
    expect(computeMttrToDeflake([], 'TC-1')).toBeUndefined();
  });

  it('returns undefined for a test still quarantined (no clear)', () => {
    const events = [{ testCaseId: 'TC-1', event: 'quarantined' as const, at: at(0) }];
    expect(computeMttrToDeflake(events, 'TC-1')).toBeUndefined();
  });
});
