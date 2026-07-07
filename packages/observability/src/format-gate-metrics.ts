import type { GateDecision } from '@warden/core';
import type { PushedMetric } from './types.js';

/** Numeric encoding of a `GateDecision['decision']` for the `warden_gate_decision` gauge. */
const DECISION_VALUE: Record<GateDecision['decision'], number> = {
  BLOCK: 0,
  WARN: 0.5,
  PASS: 1,
};

/** Metadata `emitGate` accepts alongside a `GateDecision`, per the `MetricsEmitter` contract. */
export interface GateMetricsMeta {
  pr?: number;
  module?: string;
}

/** Derives the gate-decision metric(s) for a `GateDecision`. Pure and deterministic. */
export function formatGateMetrics(
  decision: GateDecision,
  meta: GateMetricsMeta = {},
): PushedMetric[] {
  const labels: Record<string, string> = { decision: decision.decision };
  if (meta.pr !== undefined) labels.pr = String(meta.pr);
  if (meta.module !== undefined) labels.module = meta.module;

  return [
    {
      name: 'warden_gate_decision',
      help: 'Quality gate decision as a number: 1=PASS, 0.5=WARN, 0=BLOCK.',
      type: 'gauge',
      value: DECISION_VALUE[decision.decision],
      labels,
    },
  ];
}
