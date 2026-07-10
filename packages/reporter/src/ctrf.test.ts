import { describe, expect, it } from 'vitest';
import { CTRFReportSchema } from '@warden/core';
import { fixtureExecution } from '@warden/core/testing';
import { executionToCtrf } from './ctrf.js';

describe('executionToCtrf', () => {
  it('produces a CTRFReportSchema-valid report from a passing execution', () => {
    const execution = fixtureExecution();

    const report = executionToCtrf(execution);

    expect(() => CTRFReportSchema.parse(report)).not.toThrow();
    expect(report.results.tool.name).toBe('warden');
    expect(report.results.summary.tests).toBe(1);
    expect(report.results.summary.passed).toBe(1);
    expect(report.results.tests[0]?.name).toBe('TC-042');
    expect(report.results.tests[0]?.status).toBe('passed');
  });

  it('maps PASS/FAIL/SKIP statuses to passed/failed/skipped', () => {
    const execution = fixtureExecution({
      results: [
        { testCaseId: 'TC-1', status: 'PASS', duration: 10, retries: 0, flakeFlag: false },
        { testCaseId: 'TC-2', status: 'FAIL', duration: 20, retries: 1, flakeFlag: false },
        { testCaseId: 'TC-3', status: 'SKIP', duration: 0, retries: 0, flakeFlag: false },
      ],
    });

    const report = executionToCtrf(execution);

    expect(report.results.tests.map((t) => t.status)).toEqual(['passed', 'failed', 'skipped']);
    expect(report.results.summary).toMatchObject({ tests: 3, passed: 1, failed: 1, skipped: 1 });
  });

  it('carries media paths and retry info into extra', () => {
    const execution = fixtureExecution({
      results: [
        {
          testCaseId: 'TC-99',
          status: 'FAIL',
          duration: 500,
          retries: 2,
          flakeFlag: true,
          errorMessage: 'boom',
          screenshotPath: '/tmp/shot.png',
          videoPath: '/tmp/vid.mp4',
          tracePath: '/tmp/trace.zip',
          artifacts: [{ type: 'screenshot', path: '/tmp/shot.png' }],
        },
      ],
    });

    const report = executionToCtrf(execution);
    const test = report.results.tests[0];

    expect(test?.message).toBe('boom');
    expect(test?.extra?.screenshotPath).toBe('/tmp/shot.png');
    expect(test?.extra?.videoPath).toBe('/tmp/vid.mp4');
    expect(test?.extra?.tracePath).toBe('/tmp/trace.zip');
    expect(test?.extra?.retries).toBe(2);
    expect(test?.extra?.flakeFlag).toBe(true);
  });

  it('writes the human-readable name/filePath when present, keeping testCaseId as identity', () => {
    const execution = fixtureExecution({
      results: [
        {
          testCaseId: 'TC-abc',
          name: 'checkout › apply discount code',
          filePath: 'checkout.spec.ts',
          status: 'PASS',
          duration: 10,
          retries: 0,
          flakeFlag: false,
        },
      ],
    });

    const report = executionToCtrf(execution);

    expect(report.results.tests[0]?.name).toBe('checkout › apply discount code');
    expect(report.results.tests[0]?.filePath).toBe('checkout.spec.ts');
  });

  it('falls back to testCaseId as the name when no human-readable name is present', () => {
    const execution = fixtureExecution({
      results: [{ testCaseId: 'TC-xyz', status: 'PASS', duration: 10, retries: 0, flakeFlag: false }],
    });

    expect(executionToCtrf(execution).results.tests[0]?.name).toBe('TC-xyz');
  });

  it('honors a custom tool name', () => {
    const execution = fixtureExecution();

    const report = executionToCtrf(execution, { toolName: 'my-runner' });

    expect(report.results.tool.name).toBe('my-runner');
  });
});
