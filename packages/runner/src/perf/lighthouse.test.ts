import { describe, expect, it } from 'vitest';
import { CTRFReportSchema } from '@warden/core';
import {
  evaluatePerfBudgetGate,
  lighthouseResultsToCtrf,
  type LighthouseRouteResult,
  type PerfBudgetConfig,
} from './lighthouse';

const budgets: PerfBudgetConfig = {
  performanceScoreMin: 0.9,
  lcpMs: 2500,
  tbtMs: 300,
  clsScore: 0.1,
  warnMarginPercent: 10,
};

function reportWith(overrides: {
  score?: number;
  lcp?: number;
  tbt?: number;
  cls?: number;
}): LighthouseRouteResult['report'] {
  return {
    finalUrl: 'https://preview.example.com/checkout',
    categories: { performance: { score: overrides.score ?? 1 } },
    audits: {
      'largest-contentful-paint': { numericValue: overrides.lcp ?? 2000 },
      'total-blocking-time': { numericValue: overrides.tbt ?? 100 },
      'cumulative-layout-shift': { numericValue: overrides.cls ?? 0.05 },
    },
  };
}

describe('lighthouseResultsToCtrf', () => {
  it('produces a CTRFReportSchema-valid report', () => {
    const results: LighthouseRouteResult[] = [
      { route: 'https://preview.example.com/checkout', report: reportWith({}) },
    ];
    expect(CTRFReportSchema.safeParse(lighthouseResultsToCtrf(results, budgets)).success).toBe(
      true,
    );
  });

  it('sets the tool to lighthouse', () => {
    const results: LighthouseRouteResult[] = [
      { route: 'https://preview.example.com/checkout', report: reportWith({}) },
    ];
    expect(lighthouseResultsToCtrf(results, budgets).results.tool.name).toBe('lighthouse');
  });

  it('emits one test per budgeted metric present in the report', () => {
    const results: LighthouseRouteResult[] = [
      { route: 'https://preview.example.com/checkout', report: reportWith({}) },
    ];
    expect(lighthouseResultsToCtrf(results, budgets).results.tests).toHaveLength(4);
  });

  it('skips a metric entirely when the report has no value for it', () => {
    const results: LighthouseRouteResult[] = [
      {
        route: 'https://preview.example.com/checkout',
        report: { categories: { performance: { score: 0.95 } } },
      },
    ];
    const { tests } = lighthouseResultsToCtrf(results, budgets).results;
    expect(tests).toHaveLength(1);
    expect(tests[0]?.extra?.metric).toBe('performanceScore');
  });

  it('marks a metric under budget as passed with extra.value/extra.budget', () => {
    const results: LighthouseRouteResult[] = [
      { route: 'https://preview.example.com/checkout', report: reportWith({ lcp: 2000 }) },
    ];
    const { tests } = lighthouseResultsToCtrf(results, budgets).results;
    const lcp = tests.find((t) => t.name === 'https://preview.example.com/checkout: lcpMs');
    expect(lcp?.status).toBe('passed');
    expect(lcp?.extra).toMatchObject({ value: 2000, budget: 2500 });
    expect(lcp?.tags).not.toContain('near-budget');
  });

  it('marks a metric that breaches its budget as failed', () => {
    const results: LighthouseRouteResult[] = [
      { route: 'https://preview.example.com/checkout', report: reportWith({ lcp: 3000 }) },
    ];
    const { tests } = lighthouseResultsToCtrf(results, budgets).results;
    const lcp = tests.find((t) => t.name === 'https://preview.example.com/checkout: lcpMs');
    expect(lcp?.status).toBe('failed');
    expect(lcp?.message).toContain('breached');
  });

  it('tags a metric within warnMarginPercent of its budget as near-budget but still passed', () => {
    // lcp budget 2500, 10% margin -> anything > 2250 and <= 2500 is near-budget.
    const results: LighthouseRouteResult[] = [
      { route: 'https://preview.example.com/checkout', report: reportWith({ lcp: 2400 }) },
    ];
    const { tests } = lighthouseResultsToCtrf(results, budgets).results;
    const lcp = tests.find((t) => t.name === 'https://preview.example.com/checkout: lcpMs');
    expect(lcp?.status).toBe('passed');
    expect(lcp?.tags).toContain('near-budget');
  });

  it('treats performanceScore as higher-is-better (a lower score breaches)', () => {
    const results: LighthouseRouteResult[] = [
      { route: 'https://preview.example.com/checkout', report: reportWith({ score: 0.5 }) },
    ];
    const { tests } = lighthouseResultsToCtrf(results, budgets).results;
    const score = tests.find(
      (t) => t.name === 'https://preview.example.com/checkout: performanceScore',
    );
    expect(score?.status).toBe('failed');
  });

  it('returns an empty report for an empty result set', () => {
    const report = lighthouseResultsToCtrf([], budgets);
    expect(CTRFReportSchema.safeParse(report).success).toBe(true);
    expect(report.results.tests).toHaveLength(0);
  });
});

describe('evaluatePerfBudgetGate', () => {
  it('BLOCKs on any breach', () => {
    const results: LighthouseRouteResult[] = [
      { route: 'https://preview.example.com/checkout', report: reportWith({ lcp: 3000 }) },
    ];
    const gate = evaluatePerfBudgetGate(lighthouseResultsToCtrf(results, budgets));
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toContain('lcpMs');
  });

  it('WARNs when the worst case is near-budget with no breaches', () => {
    const results: LighthouseRouteResult[] = [
      { route: 'https://preview.example.com/checkout', report: reportWith({ lcp: 2400 }) },
    ];
    const gate = evaluatePerfBudgetGate(lighthouseResultsToCtrf(results, budgets));
    expect(gate.decision).toBe('WARN');
  });

  it('PASSes otherwise', () => {
    const results: LighthouseRouteResult[] = [
      { route: 'https://preview.example.com/checkout', report: reportWith({}) },
    ];
    const gate = evaluatePerfBudgetGate(lighthouseResultsToCtrf(results, budgets));
    expect(gate.decision).toBe('PASS');
  });
});
