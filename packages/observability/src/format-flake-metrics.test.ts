import { describe, expect, it } from 'vitest';
import type { FlakeClassification, FlakeImpact } from '@warden/core';
import {
  formatFlakeClassificationMetrics,
  formatFlakeImpactMetrics,
} from './format-flake-metrics.js';

describe('formatFlakeClassificationMetrics', () => {
  it('emits a root-cause tally and a confidence gauge', () => {
    const classification: FlakeClassification = {
      testCaseId: 'TC-001',
      rootCause: 'selector',
      confidence: 0.82,
      explanation: 'ambiguous locator',
      classifiedAt: new Date('2026-07-07T12:00:00.000Z'),
    };

    const metrics = formatFlakeClassificationMetrics(classification);
    const byName = Object.fromEntries(metrics.map((m) => [m.name, m]));

    expect(byName.warden_flake_root_cause_total).toEqual({
      name: 'warden_flake_root_cause_total',
      help: expect.any(String),
      type: 'gauge',
      value: 1,
      labels: { cause: 'selector' },
    });
    expect(byName.warden_flake_classification_confidence?.value).toBe(0.82);
    expect(byName.warden_flake_classification_confidence?.labels).toEqual({
      test_case_id: 'TC-001',
    });
    for (const m of metrics) expect(m.type).toBe('gauge');
  });
});

describe('formatFlakeImpactMetrics', () => {
  it('emits re-runs, ci-minutes-lost, and blocks-avoided gauges', () => {
    const impact: FlakeImpact = {
      testCaseId: 'TC-001',
      reRunsCaused: 3,
      ciMinutesLost: 2.5,
      gateBlocksAvoided: 1,
    };

    const metrics = formatFlakeImpactMetrics(impact);
    const byName = Object.fromEntries(metrics.map((m) => [m.name, m]));

    expect(byName.warden_flake_reruns_total?.value).toBe(3);
    expect(byName.warden_flake_ci_minutes_lost?.value).toBe(2.5);
    expect(byName.warden_flake_gate_blocks_avoided_total?.value).toBe(1);
    for (const m of metrics) {
      expect(m.type).toBe('gauge');
      expect(m.labels).toEqual({ test_case_id: 'TC-001' });
    }
  });
});
