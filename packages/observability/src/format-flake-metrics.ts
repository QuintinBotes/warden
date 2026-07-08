import type { FlakeClassification, FlakeImpact } from '@warden/core';
import type { PushedMetric } from './types.js';

/**
 * Derives the Prometheus metrics a single {@link FlakeClassification} contributes: a one-increment
 * root-cause tally (labelled by cause) and the classifier's confidence for that test case. Pure and
 * deterministic — no clock reads — so it is trivially unit-testable. Emitted as gauges to match the
 * pushgateway transport (`PushedMetric` is gauge-only); the `_total` name follows the counter naming
 * convention for the root-cause tally.
 */
export function formatFlakeClassificationMetrics(c: FlakeClassification): PushedMetric[] {
  return [
    {
      name: 'warden_flake_root_cause_total',
      help: 'Count of flakes classified into each root-cause category.',
      type: 'gauge',
      value: 1,
      labels: { cause: c.rootCause },
    },
    {
      name: 'warden_flake_classification_confidence',
      help: "The classifier's confidence (0-1) in a test case's root-cause classification.",
      type: 'gauge',
      value: c.confidence,
      labels: { test_case_id: c.testCaseId },
    },
  ];
}

/**
 * Derives the flake-impact metrics for a test case: re-runs caused, CI minutes lost, and gate
 * blocks the retry pass avoided. Pure and deterministic. Emitted as gauges (pushgateway transport).
 */
export function formatFlakeImpactMetrics(impact: FlakeImpact): PushedMetric[] {
  const labels = { test_case_id: impact.testCaseId };
  return [
    {
      name: 'warden_flake_reruns_total',
      help: 'Retry attempts a flaky test triggered across recent executions.',
      type: 'gauge',
      value: impact.reRunsCaused,
      labels,
    },
    {
      name: 'warden_flake_ci_minutes_lost',
      help: 'CI minutes lost to a flaky test’s retry attempts.',
      type: 'gauge',
      value: impact.ciMinutesLost,
      labels,
    },
    {
      name: 'warden_flake_gate_blocks_avoided_total',
      help: 'Gate blocks avoided by the retry pass for a flaky test.',
      type: 'gauge',
      value: impact.gateBlocksAvoided,
      labels,
    },
  ];
}
