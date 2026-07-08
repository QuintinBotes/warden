import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BrowserError,
  CTRFReportSchema,
  type CTRFReport,
  type CTRFTest,
  type GateDecision,
} from '@warden/core';

/**
 * Lighthouse performance-budget glue. Shaped exactly like `perf/k6.ts` / `security/zap.ts`: the
 * pure converter {@link lighthouseResultsToCtrf} (Lighthouse reports → CTRF) and the pure gate
 * helper {@link evaluatePerfBudgetGate} are unit-tested; {@link runLighthouseAudit}, which shells
 * out to the `lighthouse` CLI, is integration-only and not unit-tested.
 */

/** One of the metrics Warden budgets against. */
export type PerfMetric = 'performanceScore' | 'lcpMs' | 'tbtMs' | 'clsScore';

/** The subset of a Lighthouse JSON report Warden reads. */
export interface LighthouseReport {
  finalUrl?: string;
  categories?: { performance?: { score?: number } };
  audits?: Record<string, { numericValue?: number; score?: number }>;
}

/** One audited route's Lighthouse report, paired with the route it was resolved from. */
export interface LighthouseRouteResult {
  route: string;
  report: LighthouseReport;
}

/** Injected budgets, from `cfg.performance.browser.budgets`. */
export interface PerfBudgetConfig {
  performanceScoreMin: number;
  lcpMs: number;
  tbtMs: number;
  clsScore: number;
  warnMarginPercent: number;
}

function countStatus(tests: CTRFTest[], status: CTRFTest['status']): number {
  return tests.filter((t) => t.status === status).length;
}

/** Reads a metric's measured value out of a Lighthouse report. */
function readMetric(report: LighthouseReport, metric: PerfMetric): number | undefined {
  switch (metric) {
    case 'performanceScore':
      return report.categories?.performance?.score;
    case 'lcpMs':
      return report.audits?.['largest-contentful-paint']?.numericValue;
    case 'tbtMs':
      return report.audits?.['total-blocking-time']?.numericValue;
    case 'clsScore':
      return report.audits?.['cumulative-layout-shift']?.numericValue;
  }
}

/** `true` when a lower measured value is worse (everything except `performanceScore`). */
function lowerIsBetter(metric: PerfMetric): boolean {
  return metric !== 'performanceScore';
}

interface MetricEvaluation {
  metric: PerfMetric;
  value: number;
  budget: number;
  breached: boolean;
  nearBudget: boolean;
}

/** Evaluate one metric's measured value against its budget and the warn margin. */
function evaluateMetric(
  metric: PerfMetric,
  value: number,
  budget: number,
  warnMarginPercent: number,
): MetricEvaluation {
  const margin = budget * (warnMarginPercent / 100);

  if (lowerIsBetter(metric)) {
    // A higher value than the budget is a breach; being within `margin` below the budget is
    // "near" it (e.g. lcpMs 2400 with a 2500 budget and a 10% margin is near-budget).
    const breached = value > budget;
    const nearBudget = !breached && value > budget - margin;
    return { metric, value, budget, breached, nearBudget };
  }

  // Higher-is-better (performanceScore): a lower value than the budget is a breach; being within
  // `margin` above the budget is "near" it.
  const breached = value < budget;
  const nearBudget = !breached && value < budget + margin;
  return { metric, value, budget, breached, nearBudget };
}

const METRIC_BUDGETS: Record<PerfMetric, keyof PerfBudgetConfig> = {
  performanceScore: 'performanceScoreMin',
  lcpMs: 'lcpMs',
  tbtMs: 'tbtMs',
  clsScore: 'clsScore',
};

const ALL_METRICS: PerfMetric[] = ['performanceScore', 'lcpMs', 'tbtMs', 'clsScore'];

/**
 * Pure converter: one CTRF test per (route, budgeted metric). `extra` carries `route`, `metric`,
 * `value`, and `budget`. A metric that breaches its budget is `failed`; a metric within
 * `warnMarginPercent` of its budget is `passed` but tagged `near-budget` so the gate can WARN.
 */
export function lighthouseResultsToCtrf(
  results: LighthouseRouteResult[],
  budgets: PerfBudgetConfig,
): CTRFReport {
  const tests: CTRFTest[] = [];

  for (const { route, report } of results) {
    for (const metric of ALL_METRICS) {
      const value = readMetric(report, metric);
      if (value === undefined) continue;

      const budget = budgets[METRIC_BUDGETS[metric]];
      const evaluation = evaluateMetric(metric, value, budget, budgets.warnMarginPercent);

      const tags = [metric, 'performance'];
      if (evaluation.nearBudget) tags.push('near-budget');

      const test: CTRFTest = {
        name: `${route}: ${metric}`,
        status: evaluation.breached ? 'failed' : 'passed',
        duration: 0,
        tags,
        extra: { route, metric, value: evaluation.value, budget: evaluation.budget },
      };
      if (evaluation.breached) {
        test.message = `${metric} ${evaluation.value} breached budget ${evaluation.budget}`;
      }
      tests.push(test);
    }
  }

  return CTRFReportSchema.parse({
    results: {
      tool: { name: 'lighthouse' },
      summary: {
        tests: tests.length,
        passed: countStatus(tests, 'passed'),
        failed: countStatus(tests, 'failed'),
        skipped: countStatus(tests, 'skipped'),
        pending: countStatus(tests, 'pending'),
        other: countStatus(tests, 'other'),
        start: 0,
        stop: 0,
      },
      tests,
    },
  });
}

/**
 * Pure gate mapping over the CTRF output of {@link lighthouseResultsToCtrf}: any `failed` metric
 * → `BLOCK`, any `near-budget` tag with no failures → `WARN`, else `PASS`.
 */
export function evaluatePerfBudgetGate(report: CTRFReport): GateDecision {
  const { tests } = report.results;
  const failed = tests.filter((t) => t.status === 'failed');
  if (failed.length > 0) {
    return {
      decision: 'BLOCK',
      reason: `${failed.length} performance budget(s) breached: ${failed.map((t) => t.name).join(', ')}`,
    };
  }

  const nearBudget = tests.filter((t) => t.tags?.includes('near-budget'));
  if (nearBudget.length > 0) {
    return {
      decision: 'WARN',
      reason: `${nearBudget.length} metric(s) within the warn margin of their budget: ${nearBudget
        .map((t) => t.name)
        .join(', ')}`,
    };
  }

  return { decision: 'PASS', reason: 'all performance budgets satisfied' };
}

/** Options for {@link runLighthouseAudit}. */
export interface RunLighthouseOptions {
  baseUrl: string;
  chromeFlags?: string[];
}

/** Result of a {@link runLighthouseAudit} run: the raw per-route reports, CTRF, and gate. */
export interface RunLighthouseResult {
  results: LighthouseRouteResult[];
  report: CTRFReport;
  gate: GateDecision;
}

/** Shells out to the `lighthouse` CLI for a single route and reads its JSON output. */
function runLighthouseCli(route: string, outputPath: string, chromeFlags: string[]): Promise<void> {
  const args = [
    route,
    '--output=json',
    `--output-path=${outputPath}`,
    `--chrome-flags=${chromeFlags.join(' ')}`,
    '--quiet',
  ];

  return new Promise<void>((resolve, reject) => {
    const child = spawn('lighthouse', args);
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    // lighthouse exits non-zero on some warnings but still writes the report, so resolve on close
    // regardless of exit code and only fail if no report was produced.
    child.on('close', () => {
      try {
        readFileSync(outputPath);
        resolve();
      } catch {
        reject(new BrowserError(`lighthouse produced no report for ${route}. stderr: ${stderr}`));
      }
    });
  });
}

/**
 * Integration glue. NOT unit-tested (shells out to the `lighthouse` CLI per route, matching how
 * `runK6`/`runZapBaseline` shell out to their own binaries). Reads each route's JSON output,
 * converts + gates via the pure functions above.
 */
export async function runLighthouseAudit(
  routes: string[],
  budgets: PerfBudgetConfig,
  opts: RunLighthouseOptions,
): Promise<RunLighthouseResult> {
  const chromeFlags = opts.chromeFlags ?? ['--headless=new'];
  const dir = mkdtempSync(join(tmpdir(), 'warden-lighthouse-'));
  const results: LighthouseRouteResult[] = [];

  try {
    let i = 0;
    for (const route of routes) {
      // Routes coming out of `resolveChangedRoutes` are already absolute; resolving against
      // `baseUrl` here is a safety net for callers that pass bare paths directly.
      const target = new URL(route, opts.baseUrl).toString();
      const outputPath = join(dir, `report-${i}.json`);
      i += 1;
      await runLighthouseCli(target, outputPath, chromeFlags);
      let report: LighthouseReport;
      try {
        report = JSON.parse(readFileSync(outputPath, 'utf8')) as LighthouseReport;
      } catch (err) {
        throw new BrowserError(
          `failed to parse lighthouse report for ${target}: ${(err as Error).message}`,
        );
      }
      results.push({ route, report });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const report = lighthouseResultsToCtrf(results, budgets);
  return { results, report, gate: evaluatePerfBudgetGate(report) };
}
