import { describe, expect, it } from 'vitest';
import { fixtureExecution } from '@warden/core/testing';
import type { TestExecution } from '@warden/core';
import { buildRunView, toSharedRunSummary } from './run-view.js';

function execWithStatuses(): TestExecution {
  return fixtureExecution({
    id: 'EX-9',
    triggerRef: 'PR-9',
    environment: 'preview-pr-9',
    startedAt: new Date('2026-07-07T12:00:00.000Z'),
    results: [
      {
        testCaseId: 'TC-1',
        status: 'PASS',
        duration: 10,
        retries: 0,
        flakeFlag: false,
        artifacts: [],
      },
      {
        testCaseId: 'TC-2',
        status: 'PASS',
        duration: 20,
        retries: 0,
        flakeFlag: false,
        artifacts: [],
      },
      {
        testCaseId: 'TC-3',
        status: 'FAIL',
        duration: 30,
        retries: 1,
        flakeFlag: false,
        artifacts: [],
      },
      {
        testCaseId: 'TC-4',
        status: 'FLAKY',
        duration: 40,
        retries: 2,
        flakeFlag: true,
        artifacts: [],
      },
      {
        testCaseId: 'TC-5',
        status: 'SKIP',
        duration: 0,
        retries: 0,
        flakeFlag: false,
        artifacts: [],
      },
    ],
  });
}

describe('toSharedRunSummary', () => {
  it('counts totals + per-status and serializes startedAt to ISO', () => {
    const summary = toSharedRunSummary(execWithStatuses());
    expect(summary).toEqual({
      executionId: 'EX-9',
      triggerRef: 'PR-9',
      environment: 'preview-pr-9',
      startedAt: '2026-07-07T12:00:00.000Z',
      total: 5,
      passed: 2,
      failed: 1,
      flaky: 1,
    });
  });

  it('handles an empty results list', () => {
    const summary = toSharedRunSummary(fixtureExecution({ results: [] }));
    expect(summary.total).toBe(0);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.flaky).toBe(0);
  });
});

describe('buildRunView', () => {
  it('returns the summary plus a redacted result list (name+status+duration only)', () => {
    const exec = fixtureExecution({
      results: [
        {
          testCaseId: 'TC-1',
          status: 'FAIL',
          duration: 15,
          retries: 0,
          flakeFlag: false,
          artifacts: [],
          errorMessage: 'AssertionError: internal stack trace at foo.ts:42',
        },
      ],
    });
    const view = buildRunView(exec);
    expect(view.summary.total).toBe(1);
    expect(view.results).toEqual([{ name: 'TC-1', status: 'FAIL', duration: 15 }]);
  });

  it('never leaks errorMessage / stacks / artifact paths into the public view', () => {
    const exec = fixtureExecution({
      results: [
        {
          testCaseId: 'TC-1',
          status: 'FAIL',
          duration: 15,
          retries: 0,
          flakeFlag: false,
          errorMessage: 'secret-internal-detail',
          screenshotPath: '/internal/shot.png',
          artifacts: [{ type: 'trace', path: '/internal/trace.zip' }],
        },
      ],
    });
    const serialized = JSON.stringify(buildRunView(exec));
    expect(serialized).not.toContain('secret-internal-detail');
    expect(serialized).not.toContain('/internal/shot.png');
    expect(serialized).not.toContain('/internal/trace.zip');
  });
});
