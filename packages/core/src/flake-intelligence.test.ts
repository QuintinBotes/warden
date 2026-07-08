import { describe, it, expect } from 'vitest';
import { defineConfig } from './config';
import { FlakeRootCause } from './flake-intelligence';
import type { FlakeClassification, FlakeImpact, FlakeBoardEntry } from './flake-intelligence';

describe('a11y + browser-perf config', () => {
  it('defaults a11y off with WCAG 2.1 AA and impact gating', () => {
    const cfg = defineConfig({});
    expect(cfg.a11y.enabled).toBe(false);
    expect(cfg.a11y.standard).toBe('wcag21aa');
    expect(cfg.a11y.blockOnImpact).toEqual(['critical', 'serious']);
    expect(cfg.a11y.warnOnImpact).toEqual(['moderate']);
  });

  it('nests browser perf budgets under performance without disturbing p95', () => {
    const cfg = defineConfig({});
    expect(cfg.performance.p95LatencyMs).toBe(500);
    expect(cfg.performance.browser.enabled).toBe(false);
    expect(cfg.performance.browser.budgets.lcpMs).toBe(2500);
    expect(cfg.performance.browser.budgets.clsScore).toBe(0.1);
  });
});

describe('flake config', () => {
  it('defaults retry on, classifier on, and a trend gate', () => {
    const cfg = defineConfig({});
    expect(cfg.flake.retry.enabled).toBe(true);
    expect(cfg.flake.retry.maxRetries).toBe(2);
    expect(cfg.flake.retry.retryOnlyKnownFlaky).toBe(false);
    expect(cfg.flake.classifier.minHistoryForClassification).toBe(3);
    expect(cfg.flake.gate.warnOnNewlyQuarantinedAbove).toBe(2);
  });

  it('clamps maxRetries to the allowed range', () => {
    expect(() => defineConfig({ flake: { retry: { maxRetries: 9 } } })).toThrow();
  });
});

describe('flake-intelligence types', () => {
  it('exposes the root-cause enum and models a classification + board entry', () => {
    expect(FlakeRootCause.options).toContain('timing');
    const classification: FlakeClassification = {
      testCaseId: 'tc-1',
      rootCause: 'selector',
      confidence: 0.82,
      explanation: 'locator resolved a stale node after the SPA re-rendered',
      classifiedAt: new Date('2026-07-08T00:00:00Z'),
    };
    const impact: FlakeImpact = {
      testCaseId: 'tc-1',
      reRunsCaused: 4,
      ciMinutesLost: 6.5,
      gateBlocksAvoided: 1,
    };
    const entry: FlakeBoardEntry = {
      testCaseId: 'tc-1',
      flakeRate: 0.4,
      quarantined: true,
      impact,
      rootCause: classification.rootCause,
    };
    expect(entry.impact.reRunsCaused).toBe(4);
    expect(entry.rootCause).toBe('selector');
  });
});
