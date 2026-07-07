import { fixtureExecution } from '@warden/core/testing';
import { describe, expect, it } from 'vitest';
import { formatExecutionMetrics } from './format-execution-metrics.js';

describe('formatExecutionMetrics', () => {
  it('formats pass rate, duration, and flake metrics for an all-pass execution', () => {
    const execution = fixtureExecution({
      startedAt: new Date('2026-07-07T12:00:00.000Z'),
      completedAt: new Date('2026-07-07T12:00:05.000Z'),
      results: [
        {
          testCaseId: 'TC-001',
          status: 'PASS',
          duration: 100,
          retries: 0,
          flakeFlag: false,
          artifacts: [],
        },
        {
          testCaseId: 'TC-002',
          status: 'PASS',
          duration: 200,
          retries: 0,
          flakeFlag: false,
          artifacts: [],
        },
      ],
    });

    const metrics = formatExecutionMetrics(execution);
    const byName = Object.fromEntries(metrics.map((m) => [m.name, m]));

    expect(byName.warden_test_pass_rate?.value).toBe(1);
    expect(byName.warden_test_duration_seconds?.value).toBe(5);
    expect(byName.warden_test_flake_rate?.value).toBe(0);
    expect(byName.warden_tests_total?.value).toBe(2);
    expect(byName.warden_tests_failed_total?.value).toBe(0);

    for (const metric of metrics) {
      expect(metric.type).toBe('gauge');
      expect(metric.labels).toEqual({
        test_plan_id: execution.testPlanId,
        environment: execution.environment,
        trigger_type: execution.triggerType,
      });
    }
  });

  it('accounts for failures and flakes in the pass/flake rates', () => {
    const execution = fixtureExecution({
      startedAt: new Date('2026-07-07T12:00:00.000Z'),
      completedAt: new Date('2026-07-07T12:00:04.000Z'),
      results: [
        {
          testCaseId: 'TC-001',
          status: 'PASS',
          duration: 100,
          retries: 0,
          flakeFlag: false,
          artifacts: [],
        },
        {
          testCaseId: 'TC-002',
          status: 'FAIL',
          duration: 100,
          retries: 0,
          flakeFlag: false,
          artifacts: [],
        },
        {
          testCaseId: 'TC-003',
          status: 'FLAKY',
          duration: 100,
          retries: 2,
          flakeFlag: true,
          artifacts: [],
        },
        {
          testCaseId: 'TC-004',
          status: 'SKIP',
          duration: 0,
          retries: 0,
          flakeFlag: false,
          artifacts: [],
        },
      ],
    });

    const metrics = formatExecutionMetrics(execution);
    const byName = Object.fromEntries(metrics.map((m) => [m.name, m]));

    // 2 of 4 count as "passed" (PASS + FLAKY)
    expect(byName.warden_test_pass_rate?.value).toBe(0.5);
    expect(byName.warden_test_flake_rate?.value).toBe(0.25);
    expect(byName.warden_tests_total?.value).toBe(4);
    expect(byName.warden_tests_failed_total?.value).toBe(1);
    expect(byName.warden_test_duration_seconds?.value).toBe(4);
  });

  it('falls back to summed result durations when completedAt is missing', () => {
    const execution = fixtureExecution({
      startedAt: new Date('2026-07-07T12:00:00.000Z'),
      completedAt: undefined,
      results: [
        {
          testCaseId: 'TC-001',
          status: 'PASS',
          duration: 1500,
          retries: 0,
          flakeFlag: false,
          artifacts: [],
        },
        {
          testCaseId: 'TC-002',
          status: 'PASS',
          duration: 500,
          retries: 0,
          flakeFlag: false,
          artifacts: [],
        },
      ],
    });

    const metrics = formatExecutionMetrics(execution);
    const duration = metrics.find((m) => m.name === 'warden_test_duration_seconds');

    expect(duration?.value).toBe(2);
  });

  it('treats an execution with no results as a 100% pass rate and 0% flake rate', () => {
    const execution = fixtureExecution({ results: [] });

    const metrics = formatExecutionMetrics(execution);
    const byName = Object.fromEntries(metrics.map((m) => [m.name, m]));

    expect(byName.warden_test_pass_rate?.value).toBe(1);
    expect(byName.warden_test_flake_rate?.value).toBe(0);
    expect(byName.warden_tests_total?.value).toBe(0);
  });
});
