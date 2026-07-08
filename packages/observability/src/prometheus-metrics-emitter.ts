import type {
  FlakeClassification,
  GateDecision,
  MetricsEmitter,
  TestExecution,
} from '@warden/core';
import { formatExecutionMetrics } from './format-execution-metrics.js';
import { formatFlakeClassificationMetrics } from './format-flake-metrics.js';
import { formatGateMetrics } from './format-gate-metrics.js';
import type { MetricsPusher } from './types.js';

export interface PrometheusMetricsEmitterOptions {
  /** Prometheus Pushgateway job name prefix. Defaults to `'warden'`. */
  jobName?: string;
}

/**
 * `MetricsEmitter` that formats `TestExecution`s and `GateDecision`s into Prometheus metrics
 * and pushes them to a Pushgateway via an injected `MetricsPusher`. All formatting logic lives
 * in `format-execution-metrics.ts` / `format-gate-metrics.ts` so it stays independently testable.
 */
export class PrometheusMetricsEmitter implements MetricsEmitter {
  private readonly jobName: string;

  constructor(
    private readonly pusher: MetricsPusher,
    options: PrometheusMetricsEmitterOptions = {},
  ) {
    this.jobName = options.jobName ?? 'warden';
  }

  async emitExecution(execution: TestExecution): Promise<void> {
    const metrics = formatExecutionMetrics(execution);
    await this.pusher.push(`${this.jobName}_execution`, metrics);
  }

  async emitGate(
    decision: GateDecision,
    meta: { pr?: number; module?: string } = {},
  ): Promise<void> {
    const metrics = formatGateMetrics(decision, meta);
    await this.pusher.push(`${this.jobName}_gate`, metrics);
  }

  /**
   * Additive, optional `MetricsEmitter` method (flake-intelligence). Pushes the root-cause tally
   * and confidence gauge for one classification through the same pusher — no new transport.
   */
  async emitFlakeClassification(classification: FlakeClassification): Promise<void> {
    const metrics = formatFlakeClassificationMetrics(classification);
    await this.pusher.push(`${this.jobName}_flake`, metrics);
  }
}
