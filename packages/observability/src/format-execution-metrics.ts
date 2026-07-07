import type { TestExecution } from '@warden/core';
import type { PushedMetric } from './types.js';

/**
 * Derives the pass-rate / duration / flake metrics a `TestExecution` contributes.
 * Pure and deterministic — no clock reads beyond the timestamps already on the execution —
 * so it is trivially unit-testable without a fake clock.
 */
export function formatExecutionMetrics(execution: TestExecution): PushedMetric[] {
  const labels = {
    test_plan_id: execution.testPlanId,
    environment: execution.environment,
    trigger_type: execution.triggerType,
  };

  const total = execution.results.length;
  const passed = execution.results.filter(
    (r) => r.status === 'PASS' || r.status === 'FLAKY',
  ).length;
  const failed = execution.results.filter((r) => r.status === 'FAIL').length;
  const flaky = execution.results.filter((r) => r.flakeFlag).length;

  const passRate = total > 0 ? passed / total : 1;
  const flakeRate = total > 0 ? flaky / total : 0;

  const durationMs = execution.completedAt
    ? execution.completedAt.getTime() - execution.startedAt.getTime()
    : execution.results.reduce((sum, r) => sum + r.duration, 0);

  return [
    {
      name: 'warden_test_pass_rate',
      help: 'Fraction of test results that passed in this execution (0-1).',
      type: 'gauge',
      value: passRate,
      labels,
    },
    {
      name: 'warden_test_duration_seconds',
      help: 'Wall-clock duration of the test execution, in seconds.',
      type: 'gauge',
      value: durationMs / 1000,
      labels,
    },
    {
      name: 'warden_test_flake_rate',
      help: 'Fraction of test results flagged flaky in this execution (0-1).',
      type: 'gauge',
      value: flakeRate,
      labels,
    },
    {
      name: 'warden_tests_total',
      help: 'Total number of test results in this execution.',
      type: 'gauge',
      value: total,
      labels,
    },
    {
      name: 'warden_tests_failed_total',
      help: 'Number of failed test results in this execution.',
      type: 'gauge',
      value: failed,
      labels,
    },
  ];
}
