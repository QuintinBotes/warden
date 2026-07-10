import { describe, it, expect } from 'vitest';
import {
  defineConfig,
  type CujHealthReport,
  type CujHealthStatus,
  type TouchedCuj,
} from '@warden/core';
import { evaluateCujGate, mergeGateDecisions } from './gate.js';
import { fixtureCuj } from './testing-fakes.js';

const cfg = defineConfig({ cuj: { enabled: true } });

function report(cujId: string, status: CujHealthStatus, tier = 'tier1'): CujHealthReport {
  return {
    cujId,
    name: cujId,
    owningTeam: 'team',
    tier: tier as CujHealthReport['tier'],
    status,
    passRatePercent: status === 'HEALTHY' ? 100 : 0,
    steps: [],
    failingSignals: [],
    computedAt: '2026-07-09T00:00:00.000Z',
  };
}

function touch(id: string, tier: 'tier1' | 'tier2' | 'tier3' = 'tier1'): TouchedCuj {
  return {
    cuj: fixtureCuj({ id, name: id, tier }),
    matchedTags: ['@x'],
    reason: 'touched',
  };
}

describe('evaluateCujGate', () => {
  it('is a neutral PASS when no CUJ is touched (untouched journeys never gate)', () => {
    const decision = evaluateCujGate({ touched: [], before: [], after: [], cfg });
    expect(decision.decision).toBe('PASS');
  });

  it('BLOCKs an after-BROKEN journey (blockOnBroken)', () => {
    const decision = evaluateCujGate({
      touched: [touch('CUJ-1')],
      before: [report('CUJ-1', 'HEALTHY')],
      after: [report('CUJ-1', 'BROKEN')],
      cfg,
    });
    expect(decision.decision).toBe('BLOCK');
    expect(decision.reason).toContain('BROKEN');
  });

  it('BLOCKs a tier-1 degrade-from-healthy with a baseline', () => {
    const decision = evaluateCujGate({
      touched: [touch('CUJ-1', 'tier1')],
      before: [report('CUJ-1', 'HEALTHY')],
      after: [report('CUJ-1', 'DEGRADED')],
      cfg,
    });
    expect(decision.decision).toBe('BLOCK');
    expect(decision.reason).toContain('HEALTHY → DEGRADED');
  });

  it('WARNs a tier-2 degrade with a baseline', () => {
    const decision = evaluateCujGate({
      touched: [touch('CUJ-2', 'tier2')],
      before: [report('CUJ-2', 'HEALTHY', 'tier2')],
      after: [report('CUJ-2', 'DEGRADED', 'tier2')],
      cfg,
    });
    expect(decision.decision).toBe('WARN');
  });

  it('only WARNs (never BLOCKs) a degrade with no baseline', () => {
    const decision = evaluateCujGate({
      touched: [touch('CUJ-1', 'tier1')],
      before: [], // no before-health at all
      after: [report('CUJ-1', 'DEGRADED')],
      cfg,
    });
    expect(decision.decision).toBe('WARN');
    expect(decision.reason).toContain('no baseline');
  });

  it('treats a NOT_TESTED baseline as no baseline', () => {
    const decision = evaluateCujGate({
      touched: [touch('CUJ-1', 'tier1')],
      before: [report('CUJ-1', 'NOT_TESTED')],
      after: [report('CUJ-1', 'DEGRADED')],
      cfg,
    });
    expect(decision.decision).toBe('WARN');
  });

  it('WARNs when a touched journey was not tested this run (NOT_TESTED after a DEGRADED baseline)', () => {
    const decision = evaluateCujGate({
      touched: [touch('CUJ-1', 'tier1')],
      before: [report('CUJ-1', 'DEGRADED')],
      after: [report('CUJ-1', 'NOT_TESTED')],
      cfg,
    });
    expect(decision.decision).toBe('WARN');
    expect(decision.reason).toMatch(/not tested/i);
  });

  it('still BLOCKs a BROKEN journey even with no baseline', () => {
    const decision = evaluateCujGate({
      touched: [touch('CUJ-1', 'tier1')],
      before: [],
      after: [report('CUJ-1', 'BROKEN')],
      cfg,
    });
    expect(decision.decision).toBe('BLOCK');
  });

  it('PASSes when after is unchanged or improved', () => {
    const unchanged = evaluateCujGate({
      touched: [touch('CUJ-1')],
      before: [report('CUJ-1', 'HEALTHY')],
      after: [report('CUJ-1', 'HEALTHY')],
      cfg,
    });
    expect(unchanged.decision).toBe('PASS');

    const improved = evaluateCujGate({
      touched: [touch('CUJ-1')],
      before: [report('CUJ-1', 'DEGRADED')],
      after: [report('CUJ-1', 'HEALTHY')],
      cfg,
    });
    expect(improved.decision).toBe('PASS');
  });

  it('a tier-3 regression is informational PASS', () => {
    const decision = evaluateCujGate({
      touched: [touch('CUJ-3', 'tier3')],
      before: [report('CUJ-3', 'HEALTHY', 'tier3')],
      after: [report('CUJ-3', 'DEGRADED', 'tier3')],
      cfg,
    });
    expect(decision.decision).toBe('PASS');
  });

  it('folds several touched CUJs most-severe-wins', () => {
    const decision = evaluateCujGate({
      touched: [touch('CUJ-1', 'tier1'), touch('CUJ-2', 'tier2')],
      before: [report('CUJ-1', 'HEALTHY'), report('CUJ-2', 'HEALTHY', 'tier2')],
      after: [report('CUJ-1', 'BROKEN'), report('CUJ-2', 'DEGRADED', 'tier2')],
      cfg,
    });
    expect(decision.decision).toBe('BLOCK');
    // the WARN reason is preserved alongside the BLOCK
    expect(decision.reason).toContain('CUJ-1');
    expect(decision.reason).toContain('CUJ-2');
  });

  it('does not fire when the gate is disabled', () => {
    const disabled = defineConfig({ cuj: { enabled: true, gate: { enabled: false } } });
    const decision = evaluateCujGate({
      touched: [touch('CUJ-1')],
      before: [report('CUJ-1', 'HEALTHY')],
      after: [report('CUJ-1', 'BROKEN')],
      cfg: disabled,
    });
    expect(decision.decision).toBe('PASS');
  });
});

describe('mergeGateDecisions', () => {
  it('BLOCK + PASS → BLOCK with the winning reason', () => {
    const merged = mergeGateDecisions(
      { decision: 'BLOCK', reason: 'boom' },
      { decision: 'PASS', reason: 'ok' },
    );
    expect(merged.decision).toBe('BLOCK');
    expect(merged.reason).toContain('boom');
  });

  it('WARN + PASS → WARN', () => {
    const merged = mergeGateDecisions(
      { decision: 'WARN', reason: 'careful' },
      { decision: 'PASS', reason: 'ok' },
    );
    expect(merged.decision).toBe('WARN');
    expect(merged.reason).toContain('careful');
  });

  it('PASS + PASS → PASS', () => {
    const merged = mergeGateDecisions(
      { decision: 'PASS', reason: 'a' },
      { decision: 'PASS', reason: 'b' },
    );
    expect(merged.decision).toBe('PASS');
  });

  it('WARNs on an empty list — nothing to combine is not a pass', () => {
    const r = mergeGateDecisions();
    expect(r.decision).toBe('WARN');
    expect(r.reason).toMatch(/no gate decisions/i);
  });
});
