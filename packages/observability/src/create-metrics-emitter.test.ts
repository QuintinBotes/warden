import { defineConfig, WardenError } from '@warden/core';
import { fixtureExecution } from '@warden/core/testing';
import { describe, expect, it } from 'vitest';
import { createMetricsEmitter } from './create-metrics-emitter.js';
import { NoopMetricsEmitter } from './noop-metrics-emitter.js';
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

describe('createMetricsEmitter', () => {
  it('returns a NoopMetricsEmitter when observability is disabled', () => {
    const cfg = defineConfig({ observability: { enabled: false } });

    const emitter = createMetricsEmitter(cfg);

    expect(emitter).toBeInstanceOf(NoopMetricsEmitter);
  });

  it('returns a PrometheusMetricsEmitter backed by the injected pusher when enabled', async () => {
    const cfg = defineConfig({
      observability: { enabled: true, pushgatewayUrl: 'http://pg:9091' },
    });
    const { pusher, calls } = fakePusher();

    const emitter = createMetricsEmitter(cfg, { pusher });

    expect(emitter).toBeInstanceOf(PrometheusMetricsEmitter);
    await emitter.emitExecution(fixtureExecution());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.job).toBe('warden_execution');
  });

  it('uses an injected pusher even without a configured pushgatewayUrl', async () => {
    const cfg = defineConfig({ observability: { enabled: true } });
    const { pusher, calls } = fakePusher();

    const emitter = createMetricsEmitter(cfg, { pusher, jobName: 'nightly' });
    await emitter.emitExecution(fixtureExecution());

    expect(calls[0]?.job).toBe('nightly_execution');
  });

  it('throws a WardenError when enabled without a pushgatewayUrl or an injected pusher', () => {
    const cfg = defineConfig({ observability: { enabled: true } });

    expect(() => createMetricsEmitter(cfg)).toThrow(WardenError);
    expect(() => createMetricsEmitter(cfg)).toThrow(/pushgatewayUrl/);
  });
});
