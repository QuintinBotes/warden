import { describe, expect, it } from 'vitest';
import { defineConfig } from './config';
import { evaluatePassRateGate } from './gates';
import type { TestStatus } from './schema';

const cfg = defineConfig();

function results(...statuses: TestStatus[]): Array<{ status: TestStatus }> {
  return statuses.map((status) => ({ status }));
}

function pass(n: number): TestStatus[] {
  return Array.from({ length: n }, () => 'PASS' as const);
}

describe('evaluatePassRateGate', () => {
  it('blocks a mostly-skipped run — the tests that ran are not the whole answer', () => {
    const gate = evaluatePassRateGate(
      results('PASS', 'SKIP', 'SKIP', 'SKIP', 'SKIP', 'SKIP', 'SKIP', 'SKIP', 'SKIP', 'SKIP'),
      cfg.gates,
    );

    expect(gate?.decision).toBe('BLOCK');
    expect(gate?.reason).toBe('Blocked: pass rate 10.0% is below the required 90%.');
  });

  it('stays silent when the rate clears the configured threshold', () => {
    expect(evaluatePassRateGate(results(...pass(19), 'SKIP'), cfg.gates)).toBeUndefined();
  });

  it('reads the threshold from the config rather than a fixed number', () => {
    const strict = defineConfig({ gates: { blockOnPassRateBelowPercent: 100 } });
    const relaxed = defineConfig({ gates: { blockOnPassRateBelowPercent: 10 } });
    const nineteenOfTwenty = results(...pass(19), 'SKIP');

    expect(evaluatePassRateGate(nineteenOfTwenty, strict.gates)?.decision).toBe('BLOCK');
    expect(evaluatePassRateGate(nineteenOfTwenty, relaxed.gates)).toBeUndefined();
  });

  it('counts SKIP and BLOCKED against the rate — neither produced an answer', () => {
    expect(evaluatePassRateGate(results(...pass(8), 'BLOCKED', 'SKIP'), cfg.gates)?.reason).toBe(
      'Blocked: pass rate 80.0% is below the required 90%.',
    );
  });

  it('counts FLAKY as green — a retry that passed is gated by the flake rules, not this one', () => {
    // Counting flakes here would block the run before `flake.gate` could ever warn about them.
    expect(evaluatePassRateGate(results('FLAKY', 'FLAKY', 'FLAKY'), cfg.gates)).toBeUndefined();
  });

  it('is silent on an empty result set — 0/0 is not a pass rate to claim either way', () => {
    expect(evaluatePassRateGate([], cfg.gates)).toBeUndefined();
  });

  it('can be turned off entirely with a threshold of 0', () => {
    const off = defineConfig({ gates: { blockOnPassRateBelowPercent: 0 } });
    expect(evaluatePassRateGate(results('SKIP', 'SKIP'), off.gates)).toBeUndefined();
  });
});
