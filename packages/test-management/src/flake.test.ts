import { describe, expect, it } from 'vitest';
import type { TestResult } from '@warden/core';
import { computeFlakeRate, shouldQuarantine } from './flake.js';

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
