import { fixtureExecution } from '@warden/core/testing';
import { describe, expect, it } from 'vitest';
import { PrometheusMetricsEmitter } from './prometheus-metrics-emitter.js';
import type { MetricsPusher, PushedMetric } from './types.js';

function fakePusher() {
  const calls: { job: string; metrics: PushedMetric[] }[] = [];
  const pusher: MetricsPusher = {
    async push(job, metrics) {
      calls.push({ job, metrics });
    },
  };
  return { pusher, calls };
}

describe('PrometheusMetricsEmitter', () => {
  it('pushes execution metrics under a job named "<jobName>_execution"', async () => {
    const { pusher, calls } = fakePusher();
    const emitter = new PrometheusMetricsEmitter(pusher);

    const execution = fixtureExecution();
    await emitter.emitExecution(execution);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.job).toBe('warden_execution');
    const names = calls[0]?.metrics.map((m) => m.name).sort();
    expect(names).toEqual(
      [
        'warden_test_pass_rate',
        'warden_test_duration_seconds',
        'warden_test_flake_rate',
        'warden_tests_total',
        'warden_tests_failed_total',
      ].sort(),
    );
  });

  it('pushes gate metrics under a job named "<jobName>_gate"', async () => {
    const { pusher, calls } = fakePusher();
    const emitter = new PrometheusMetricsEmitter(pusher);

    await emitter.emitGate({ decision: 'BLOCK', reason: '1 failed' }, { pr: 482 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.job).toBe('warden_gate');
    expect(calls[0]?.metrics).toEqual([
      {
        name: 'warden_gate_decision',
        help: 'Quality gate decision as a number: 1=PASS, 0.5=WARN, 0=BLOCK.',
        type: 'gauge',
        value: 0,
        labels: { decision: 'BLOCK', pr: '482' },
      },
    ]);
  });

  it('pushes flake-classification metrics under a job named "<jobName>_flake"', async () => {
    const { pusher, calls } = fakePusher();
    const emitter = new PrometheusMetricsEmitter(pusher);

    await emitter.emitFlakeClassification({
      testCaseId: 'TC-001',
      rootCause: 'timing',
      confidence: 0.7,
      explanation: 'timeout waiting for redirect',
      classifiedAt: new Date('2026-07-07T12:00:00.000Z'),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.job).toBe('warden_flake');
    const names = calls[0]?.metrics.map((m) => m.name).sort();
    expect(names).toEqual(
      ['warden_flake_root_cause_total', 'warden_flake_classification_confidence'].sort(),
    );
  });

  it('respects a custom jobName prefix', async () => {
    const { pusher, calls } = fakePusher();
    const emitter = new PrometheusMetricsEmitter(pusher, { jobName: 'ci-nightly' });

    await emitter.emitExecution(fixtureExecution());
    await emitter.emitGate({ decision: 'PASS', reason: 'ok' });

    expect(calls[0]?.job).toBe('ci-nightly_execution');
    expect(calls[1]?.job).toBe('ci-nightly_gate');
  });
});
