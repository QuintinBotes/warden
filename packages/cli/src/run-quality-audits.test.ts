import { describe, it, expect } from 'vitest';
import { defineConfig } from '@warden/core';
import type { ChangeSurface, CTRFReport, GateDecision } from '@warden/core';
import { runQualityAudits } from './run-quality-audits';

const surface: ChangeSurface = {
  changedFiles: ['apps/checkout/app/page.tsx'],
  changedModules: ['apps/checkout'],
  testTags: [],
  riskScore: 0,
  selectedTiers: [],
} as unknown as ChangeSurface;

function ctrf(name: string): CTRFReport {
  return {
    results: {
      tool: { name },
      summary: {
        tests: 1,
        passed: 0,
        failed: 1,
        pending: 0,
        skipped: 0,
        other: 0,
        start: 0,
        stop: 0,
      },
      tests: [{ name, status: 'failed', duration: 1 }],
    },
  } as unknown as CTRFReport;
}

function capture() {
  const writes: Record<string, string> = {};
  return {
    writes,
    writeFile: async (file: string, contents: string) => {
      writes[file] = contents;
    },
  };
}

describe('runQualityAudits', () => {
  it('runs the a11y tier when enabled, writes CTRF, and returns its gate', async () => {
    const cfg = defineConfig({
      a11y: {
        enabled: true,
        routes: [{ pathPrefix: 'apps/checkout/', urlPattern: '/checkout/*' }],
      },
    });
    const cap = capture();
    const gate: GateDecision = { decision: 'BLOCK', reason: 'axe found 1 critical violation' };
    let receivedRoutes: string[] = [];

    const res = await runQualityAudits({
      changeSurface: surface,
      baseUrl: 'https://preview.example.com',
      cfg,
      artifactsDir: '/tmp/art',
      writeFile: cap.writeFile,
      a11yAudit: async (routes) => {
        receivedRoutes = routes;
        return { results: [], report: ctrf('warden-a11y'), gate };
      },
    });

    expect(receivedRoutes).toEqual(['https://preview.example.com/checkout/app/page.tsx']);
    expect(res.gates).toEqual([gate]);
    expect(res.reports.a11y?.results.tool.name).toBe('warden-a11y');
    expect(Object.keys(cap.writes)).toContain('/tmp/art/a11y-report.json');
  });

  it('is a quiet no-op when the tier is disabled', async () => {
    const cfg = defineConfig({});
    const res = await runQualityAudits({
      changeSurface: surface,
      baseUrl: 'https://preview.example.com',
      cfg,
      artifactsDir: '/tmp/art',
      writeFile: capture().writeFile,
    });
    expect(res.gates).toEqual([]);
    expect(res.written).toEqual([]);
  });

  it('skips a tier that resolves no changed routes (never a false gate)', async () => {
    const cfg = defineConfig({
      a11y: { enabled: true, routes: [{ pathPrefix: 'apps/admin/', urlPattern: '/admin/*' }] },
    });
    let called = false;
    const res = await runQualityAudits({
      changeSurface: surface, // touches apps/checkout, not apps/admin
      baseUrl: 'https://preview.example.com',
      cfg,
      artifactsDir: '/tmp/art',
      writeFile: capture().writeFile,
      a11yAudit: async () => {
        called = true;
        return { results: [], report: ctrf('warden-a11y'), gate: { decision: 'PASS', reason: '' } };
      },
    });
    expect(called).toBe(false);
    expect(res.gates).toEqual([]);
  });

  it('runs the perf-budget tier with budgets + warnMarginPercent folded in', async () => {
    const cfg = defineConfig({
      performance: {
        browser: {
          enabled: true,
          routes: [{ pathPrefix: 'apps/checkout/', urlPattern: '/checkout/*' }],
        },
      },
    });
    const cap = capture();
    let receivedBudgets: unknown;
    const res = await runQualityAudits({
      changeSurface: surface,
      baseUrl: 'https://preview.example.com',
      cfg,
      artifactsDir: '/tmp/art',
      writeFile: cap.writeFile,
      perfAudit: async (_routes, budgets) => {
        receivedBudgets = budgets;
        return {
          results: [],
          report: ctrf('warden-perf'),
          gate: { decision: 'WARN', reason: 'LCP within 10% of budget' },
        };
      },
    });
    expect(receivedBudgets).toMatchObject({ lcpMs: 2500, warnMarginPercent: 10 });
    expect(res.gates[0]?.decision).toBe('WARN');
    expect(Object.keys(cap.writes)).toContain('/tmp/art/perf-report.json');
  });
});
