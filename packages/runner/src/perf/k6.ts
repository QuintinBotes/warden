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
 * k6 load-test glue. Two pure pieces — {@link k6SummaryToCtrf} (summary → CTRF) and
 * {@link evaluateK6Thresholds} (summary → gate) — are unit-tested; {@link runK6}, which shells
 * out to the `k6` binary, is integration-only and not unit-tested (the pure pieces it delegates
 * to are covered instead).
 */

/** A single threshold outcome as emitted by k6's `handleSummary`. */
export interface K6ThresholdResult {
  /** `true` when the threshold held (did not breach). */
  ok: boolean;
}

/** A k6 metric block from the end-of-test summary. */
export interface K6Metric {
  /** Threshold expression → result, e.g. `'p(95)<500': { ok: true }`. */
  thresholds?: Record<string, K6ThresholdResult>;
  /** Computed metric values, e.g. `{ 'p(95)': 480, count: 1500, rate: 50 }`. */
  values?: Record<string, number>;
}

/** The subset of k6's end-of-test summary JSON that Warden consumes. */
export interface K6Summary {
  metrics?: Record<string, K6Metric>;
  state?: { testRunDurationMs?: number };
}

/** Injected numeric limits used to turn a k6 run into a {@link GateDecision}. */
export interface K6ThresholdConfig {
  /** Maximum acceptable p95 of `http_req_duration` in milliseconds. */
  p95Ms?: number;
  /** Minimum acceptable throughput (requests/sec) from `http_reqs.rate`. */
  throughput?: number;
}

function countStatus(tests: CTRFTest[], status: CTRFTest['status']): number {
  return tests.filter((t) => t.status === status).length;
}

/**
 * Pure converter from a k6 end-of-test summary to a {@link CTRFReport}. Each configured
 * threshold becomes one CTRF test (passed when it held, failed when it breached), tagged with
 * its metric and expression. Output is validated with {@link CTRFReportSchema}.
 */
export function k6SummaryToCtrf(json: unknown): CTRFReport {
  const summary = (json ?? {}) as K6Summary;
  const metrics = summary.metrics ?? {};

  const tests: CTRFTest[] = [];
  for (const [metricName, metric] of Object.entries(metrics)) {
    const thresholds = metric.thresholds;
    if (!thresholds) continue;
    for (const [expr, result] of Object.entries(thresholds)) {
      const passed = result.ok === true;
      const test: CTRFTest = {
        name: `${metricName}: ${expr}`,
        status: passed ? 'passed' : 'failed',
        duration: 0,
        tags: [metricName, 'performance'],
      };
      if (!passed) {
        test.message = `k6 threshold breached: ${metricName} ${expr}`;
      }
      const values = metric.values;
      if (values) test.extra = { metric: metricName, values };
      tests.push(test);
    }
  }

  const duration = summary.state?.testRunDurationMs ?? 0;

  return CTRFReportSchema.parse({
    results: {
      tool: { name: 'k6' },
      summary: {
        tests: tests.length,
        passed: countStatus(tests, 'passed'),
        failed: countStatus(tests, 'failed'),
        skipped: countStatus(tests, 'skipped'),
        pending: countStatus(tests, 'pending'),
        other: countStatus(tests, 'other'),
        start: 0,
        stop: duration,
      },
      tests,
    },
  });
}

/**
 * Pure gate mapping for a k6 run. Reads `http_req_duration.p(95)` and `http_reqs.rate` from the
 * summary and compares them against the injected limits: any breach → `BLOCK`, otherwise `PASS`.
 */
export function evaluateK6Thresholds(json: unknown, cfg: K6ThresholdConfig): GateDecision {
  const summary = (json ?? {}) as K6Summary;
  const metrics = summary.metrics ?? {};

  const p95 = metrics.http_req_duration?.values?.['p(95)'];
  const throughput = metrics.http_reqs?.values?.rate;

  const reasons: string[] = [];
  if (cfg.p95Ms !== undefined && p95 !== undefined && p95 > cfg.p95Ms) {
    reasons.push(`p95 latency ${p95}ms exceeds limit ${cfg.p95Ms}ms`);
  }
  if (cfg.throughput !== undefined && throughput !== undefined && throughput < cfg.throughput) {
    reasons.push(`throughput ${throughput} req/s below required ${cfg.throughput} req/s`);
  }

  if (reasons.length > 0) {
    return { decision: 'BLOCK', reason: reasons.join('; ') };
  }
  return { decision: 'PASS', reason: 'k6 performance thresholds satisfied' };
}

/** Options for {@link runK6}. */
export interface RunK6Options {
  /** Working directory to run k6 in. Defaults to the current process cwd. */
  cwd?: string;
  /** Extra environment variables (surfaced to the script as `__ENV`). */
  env?: Record<string, string>;
}

/** Result of a {@link runK6} run: the raw summary, its CTRF report, and the gate decision. */
export interface RunK6Result {
  summary: K6Summary;
  report: CTRFReport;
  gate: GateDecision;
}

/**
 * Integration glue that shells out to the `k6` binary. NOT unit-tested (it spawns a child
 * process and drives a real load test). Runs `k6 run --summary-export`, reads the exported
 * summary, converts it to CTRF via {@link k6SummaryToCtrf}, and evaluates the gate via
 * {@link evaluateK6Thresholds}.
 */
export function runK6(
  scriptPath: string,
  thresholds: K6ThresholdConfig,
  opts: RunK6Options = {},
): Promise<RunK6Result> {
  const dir = mkdtempSync(join(tmpdir(), 'warden-k6-'));
  const summaryPath = join(dir, 'summary.json');
  const args = ['run', `--summary-export=${summaryPath}`, scriptPath];

  return new Promise<void>((resolve, reject) => {
    const child = spawn('k6', args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    // k6 exits non-zero when thresholds are breached but still writes the summary export, so we
    // resolve on close regardless of exit code and only fail if no summary was produced.
    child.on('close', () => {
      try {
        readFileSync(summaryPath);
        resolve();
      } catch {
        reject(new BrowserError(`k6 produced no summary export. stderr: ${stderr}`));
      }
    });
  }).then(() => {
    let summary: K6Summary;
    try {
      summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as K6Summary;
    } catch (err) {
      throw new BrowserError(`failed to parse k6 summary export: ${(err as Error).message}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return {
      summary,
      report: k6SummaryToCtrf(summary),
      gate: evaluateK6Thresholds(summary, thresholds),
    };
  });
}
