import { describe, expect, it } from 'vitest';
import { formatGateMetrics } from './format-gate-metrics.js';

describe('formatGateMetrics', () => {
  it('encodes PASS as 1 with a decision label', () => {
    const metrics = formatGateMetrics({ decision: 'PASS', reason: 'All tests passed' });

    expect(metrics).toEqual([
      {
        name: 'warden_gate_decision',
        help: 'Quality gate decision as a number: 1=PASS, 0.5=WARN, 0=BLOCK.',
        type: 'gauge',
        value: 1,
        labels: { decision: 'PASS' },
      },
    ]);
  });

  it('encodes WARN as 0.5 and BLOCK as 0', () => {
    expect(formatGateMetrics({ decision: 'WARN', reason: '1 flaky' })[0]?.value).toBe(0.5);
    expect(formatGateMetrics({ decision: 'BLOCK', reason: '1 failed' })[0]?.value).toBe(0);
  });

  it('adds pr and module labels when provided in meta', () => {
    const metrics = formatGateMetrics(
      { decision: 'BLOCK', reason: '1 failed' },
      { pr: 482, module: 'apps/checkout' },
    );

    expect(metrics[0]?.labels).toEqual({
      decision: 'BLOCK',
      pr: '482',
      module: 'apps/checkout',
    });
  });

  it('omits pr and module labels when meta is empty', () => {
    const metrics = formatGateMetrics({ decision: 'PASS', reason: 'ok' });

    expect(metrics[0]?.labels).toEqual({ decision: 'PASS' });
  });
});
