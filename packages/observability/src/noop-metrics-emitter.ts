import type { GateDecision, MetricsEmitter, TestExecution } from '@warden/core';

/**
 * `MetricsEmitter` that does nothing. Returned by `createMetricsEmitter` when
 * `cfg.observability.enabled` is `false`, so callers never need to branch on whether
 * observability is on before calling `emitExecution` / `emitGate`.
 */
export class NoopMetricsEmitter implements MetricsEmitter {
  async emitExecution(_execution: TestExecution): Promise<void> {
    // Intentionally a no-op.
  }

  async emitGate(
    _decision: GateDecision,
    _meta: { pr?: number; module?: string } = {},
  ): Promise<void> {
    // Intentionally a no-op.
  }
}
