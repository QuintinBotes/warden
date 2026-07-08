import { describe, expect, it } from 'vitest';
import type { CTRFReport } from '@warden/core';
import { ctrfToExecution } from './ctrf-execution';

function fixtureReport(overrides: Partial<CTRFReport['results']> = {}): CTRFReport {
  return {
    results: {
      tool: { name: 'playwright' },
      summary: {
        tests: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        pending: 0,
        other: 0,
        start: 1000,
        stop: 2000,
      },
      tests: [
        { name: 'login works', status: 'passed', duration: 500, filePath: 'login.spec.ts' },
        {
          name: 'checkout fails',
          status: 'failed',
          duration: 700,
          message: 'boom',
          filePath: 'checkout.spec.ts',
        },
      ],
      ...overrides,
    },
  };
}

describe('ctrfToExecution', () => {
  it('maps every CTRF test into a TestResult with the right status', () => {
    const report = fixtureReport();
    const execution = ctrfToExecution(report);

    expect(execution.results).toHaveLength(2);
    expect(execution.results[0]).toMatchObject({ status: 'PASS', duration: 500 });
    expect(execution.results[1]).toMatchObject({
      status: 'FAIL',
      duration: 700,
      errorMessage: 'boom',
    });
  });

  it('maps skipped/pending/other CTRF statuses onto TestStatus', () => {
    const report = fixtureReport({
      tests: [
        { name: 'a', status: 'skipped', duration: 1 },
        { name: 'b', status: 'pending', duration: 1 },
        { name: 'c', status: 'other', duration: 1 },
      ],
    });
    const execution = ctrfToExecution(report);
    expect(execution.results.map((r) => r.status)).toEqual(['SKIP', 'BLOCKED', 'SKIP']);
  });

  it('derives startedAt/completedAt from the CTRF summary', () => {
    const report = fixtureReport();
    const execution = ctrfToExecution(report);
    expect(execution.startedAt).toEqual(new Date(1000));
    expect(execution.completedAt).toEqual(new Date(2000));
  });

  it('produces the same testCaseId for the same test name across runs (stable ids)', () => {
    const report = fixtureReport();
    const a = ctrfToExecution(report);
    const b = ctrfToExecution(report);
    expect(a.results[0]?.testCaseId).toBe(b.results[0]?.testCaseId);
  });

  it('honors triggerType/triggerRef/environment/testPlanId overrides', () => {
    const report = fixtureReport();
    const execution = ctrfToExecution(report, {
      triggerType: 'pr',
      triggerRef: '42',
      environment: 'staging',
      testPlanId: 'PLAN-1',
    });
    expect(execution.triggerType).toBe('pr');
    expect(execution.triggerRef).toBe('42');
    expect(execution.environment).toBe('staging');
    expect(execution.testPlanId).toBe('PLAN-1');
  });

  it('defaults triggerType to manual and environment to ci', () => {
    const execution = ctrfToExecution(fixtureReport());
    expect(execution.triggerType).toBe('manual');
    expect(execution.environment).toBe('ci');
  });

  it('stamps retries/flakeFlag from retryMeta and marks a flaky pass as FLAKY', () => {
    const report = fixtureReport({
      tests: [
        { name: 'login works', status: 'passed', duration: 500, filePath: 'login.spec.ts' },
        { name: 'checkout fails', status: 'passed', duration: 700, filePath: 'checkout.spec.ts' },
      ],
    });
    const retryMeta = new Map([
      ['checkout.spec.ts::checkout fails', { retries: 1, flakeFlag: true }],
    ]);

    const execution = ctrfToExecution(report, { retryMeta });

    const flaky = execution.results[1];
    expect(flaky?.status).toBe('FLAKY');
    expect(flaky?.retries).toBe(1);
    expect(flaky?.flakeFlag).toBe(true);
    // untouched test keeps the defaults
    expect(execution.results[0]).toMatchObject({ status: 'PASS', retries: 0, flakeFlag: false });
  });
});
