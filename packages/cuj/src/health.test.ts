import { describe, it, expect } from 'vitest';
import type { CujSignal } from '@warden/core';
import { computeCujHealth } from './health.js';
import { fixtureCuj, fixtureResult } from './testing-fakes.js';

const NOW = new Date('2026-07-09T00:00:00.000Z');
const health = (
  cuj: Parameters<typeof computeCujHealth>[0],
  results: Parameters<typeof computeCujHealth>[1],
  signals?: CujSignal[],
) => computeCujHealth(cuj, results, signals, { now: NOW });

describe('computeCujHealth — worst-of rollup', () => {
  it('is NOT_TESTED when no linked test has a result', () => {
    const report = health(fixtureCuj(), []);
    expect(report.status).toBe('NOT_TESTED');
    expect(report.passRatePercent).toBe(0);
    expect(report.computedAt).toBe(NOW.toISOString());
  });

  it('is HEALTHY when every linked test passed', () => {
    const report = health(fixtureCuj(), [
      fixtureResult('TC-cart', 'PASS'),
      fixtureResult('TC-pay', 'PASS'),
    ]);
    expect(report.status).toBe('HEALTHY');
    expect(report.passRatePercent).toBe(100);
  });

  it('is BROKEN when any linked test FAILed', () => {
    const report = health(fixtureCuj(), [
      fixtureResult('TC-cart', 'PASS'),
      fixtureResult('TC-pay', 'FAIL'),
    ]);
    expect(report.status).toBe('BROKEN');
  });

  it('is BROKEN when any linked test is BLOCKED', () => {
    const report = health(fixtureCuj(), [
      fixtureResult('TC-cart', 'BLOCKED'),
      fixtureResult('TC-pay', 'PASS'),
    ]);
    expect(report.status).toBe('BROKEN');
  });

  it('is DEGRADED when pass rate is below the (default 100%) threshold', () => {
    const report = health(fixtureCuj(), [
      fixtureResult('TC-cart', 'PASS'),
      fixtureResult('TC-pay', 'FLAKY'),
    ]);
    expect(report.status).toBe('DEGRADED');
    expect(report.passRatePercent).toBe(50);
  });

  it('honours a relaxed minPassRatePercent threshold', () => {
    const cuj = fixtureCuj({ thresholds: { minPassRatePercent: 50 } });
    const report = health(cuj, [
      fixtureResult('TC-cart', 'PASS'),
      fixtureResult('TC-pay', 'FLAKY'),
    ]);
    // 50% meets a 50% floor → HEALTHY.
    expect(report.status).toBe('HEALTHY');
  });

  it('uses the latest result per test case (last write wins)', () => {
    const report = health(fixtureCuj(), [
      fixtureResult('TC-pay', 'FAIL'),
      fixtureResult('TC-pay', 'PASS'), // later run recovered
      fixtureResult('TC-cart', 'PASS'),
    ]);
    expect(report.status).toBe('HEALTHY');
  });

  it('downgrades to DEGRADED on a failing non-blocking signal', () => {
    const report = health(
      fixtureCuj(),
      [fixtureResult('TC-cart', 'PASS'), fixtureResult('TC-pay', 'PASS')],
      [{ kind: 'perf', value: 900, passed: false }],
    );
    expect(report.status).toBe('DEGRADED');
    expect(report.failingSignals).toHaveLength(1);
  });

  it('downgrades to BROKEN on a failing blocking signal', () => {
    const report = health(
      fixtureCuj(),
      [fixtureResult('TC-cart', 'PASS'), fixtureResult('TC-pay', 'PASS')],
      [{ kind: 'a11y', value: 3, passed: false, blocking: true }],
    );
    expect(report.status).toBe('BROKEN');
  });

  it('an absent (not-run) signal never downgrades health', () => {
    const report = health(
      fixtureCuj(),
      [fixtureResult('TC-cart', 'PASS'), fixtureResult('TC-pay', 'PASS')],
      [{ kind: 'visual', value: 0, passed: true }],
    );
    expect(report.status).toBe('HEALTHY');
    expect(report.failingSignals).toEqual([]);
  });

  it('reports per-step status as the worst-of that step own tests', () => {
    const report = health(fixtureCuj(), [
      fixtureResult('TC-cart', 'PASS'),
      fixtureResult('TC-pay', 'FAIL'),
    ]);
    const byName = Object.fromEntries(report.steps.map((s) => [s.name, s.status]));
    expect(byName['Add item to cart']).toBe('HEALTHY');
    expect(byName['Pay']).toBe('BROKEN');
  });

  it('marks a step with no linked test result NOT_TESTED (dangling links surface)', () => {
    const cuj = fixtureCuj({
      steps: [
        { order: 1, name: 'Add item to cart', module: '@apps/cart', testIds: ['TC-cart'] },
        { order: 2, name: 'Confirm', module: '@apps/checkout', testIds: ['TC-missing'] },
      ],
    });
    const report = health(cuj, [fixtureResult('TC-cart', 'PASS')]);
    const confirm = report.steps.find((s) => s.name === 'Confirm');
    expect(confirm!.status).toBe('NOT_TESTED');
  });

  it('sorts steps by order', () => {
    const cuj = fixtureCuj({
      steps: [
        { order: 2, name: 'second', module: '@m', testIds: [] },
        { order: 1, name: 'first', module: '@m', testIds: [] },
      ],
    });
    const report = health(cuj, []);
    expect(report.steps.map((s) => s.name)).toEqual(['first', 'second']);
  });
});
