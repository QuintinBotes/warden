import { WardenError, type MetricsEmitter, type WardenConfig } from '@warden/core';
import { NoopMetricsEmitter } from './noop-metrics-emitter.js';
import { PromClientPusher } from './prom-client-pusher.js';
import { PrometheusMetricsEmitter } from './prometheus-metrics-emitter.js';
import type { MetricsPusher } from './types.js';

/** Collaborators `createMetricsEmitter` may need, injected so tests never touch a real network. */
export interface CreateMetricsEmitterDeps {
  /** Overrides the default `PromClientPusher`. Tests inject a fake here. */
  pusher?: MetricsPusher;
  /** Prometheus Pushgateway job name prefix. Defaults to `'warden'`. */
  jobName?: string;
}

/**
 * Builds the `MetricsEmitter` selected by `cfg.observability`. Returns a `NoopMetricsEmitter`
 * when observability is disabled, otherwise a `PrometheusMetricsEmitter` backed by
 * `deps.pusher` (if supplied) or a `PromClientPusher` pointed at `cfg.observability.pushgatewayUrl`.
 */
export function createMetricsEmitter(
  cfg: WardenConfig,
  deps: CreateMetricsEmitterDeps = {},
): MetricsEmitter {
  if (!cfg.observability.enabled) {
    return new NoopMetricsEmitter();
  }

  if (deps.pusher) {
    return new PrometheusMetricsEmitter(deps.pusher, { jobName: deps.jobName });
  }

  if (!cfg.observability.pushgatewayUrl) {
    throw new WardenError(
      'cfg.observability.pushgatewayUrl (or an injected pusher) is required when cfg.observability.enabled is true',
      'OBSERVABILITY_MISSING_PUSHGATEWAY_URL',
    );
  }

  const pusher = new PromClientPusher(cfg.observability.pushgatewayUrl);
  return new PrometheusMetricsEmitter(pusher, { jobName: deps.jobName });
}
