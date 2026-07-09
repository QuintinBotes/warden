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
 * A separate, richer k6 load-testing tier — VUs, duration, and multiple thresholds (p95/p99
 * latency + error rate) — distinct from the single API p95 budget already covered by
 * `perf/k6.ts`. Shaped identically: the pure converter {@link k6LoadResultsToCtrf} (summary →
 * CTRF) and the pure gate helper {@link evaluateLoadGate} are unit-tested; {@link runK6Load},
 * which shells out to the `k6` binary, is integration-only and not unit-tested.
 */

/** A normalized k6 load-test summary: the subset of metrics Warden's load tier gates on. */
export interface K6LoadSummary {
  /** p95 of `http_req_duration`, in milliseconds. */
  p95Ms: number;
  /** p99 of `http_req_duration`, in milliseconds. */
  p99Ms: number;
  /** `http_req_failed` rate, as a fraction (0..1). */
  errorRate: number;
  /** Total requests issued (`http_reqs` count), for context only — not gated on. */
  requests: number;
}

/** Injected numeric budgets used to turn a {@link K6LoadSummary} into CTRF tests + a gate. */
export interface K6LoadThresholds {
  /** Maximum acceptable p95 of `http_req_duration`, in milliseconds. */
  p95Ms: number;
  /** Maximum acceptable p99 of `http_req_duration`, in milliseconds. */
  p99Ms: number;
  /** Maximum acceptable error rate, as a fraction (0..1). */
  errorRate: number;
}

function countStatus(tests: CTRFTest[], status: CTRFTest['status']): number {
  return tests.filter((t) => t.status === status).length;
}

/** Build one CTRF test comparing an observed value against its budget. */
function thresholdTest(metric: string, observed: number, budget: number, unit: string): CTRFTest {
  const passed = observed <= budget;
  const test: CTRFTest = {
    name: `${metric} <${budget}${unit}`,
    status: passed ? 'passed' : 'failed',
    duration: 0,
    tags: ['load', metric],
    extra: { metric, observed, budget },
  };
  if (!passed) {
    test.message = `${metric} ${observed}${unit} exceeds budget ${budget}${unit}`;
  }
  return test;
}

/**
 * Pure converter from a normalized {@link K6LoadSummary} to a {@link CTRFReport}. One CTRF test
 * per configured threshold (p95 latency, p99 latency, error rate): `passed` when the observed
 * value is within budget, `failed` otherwise. Output is validated with {@link CTRFReportSchema}.
 */
export function k6LoadResultsToCtrf(
  summary: K6LoadSummary,
  thresholds: K6LoadThresholds,
): CTRFReport {
  const tests: CTRFTest[] = [
    thresholdTest('p95Ms', summary.p95Ms, thresholds.p95Ms, 'ms'),
    thresholdTest('p99Ms', summary.p99Ms, thresholds.p99Ms, 'ms'),
    thresholdTest('errorRate', summary.errorRate, thresholds.errorRate, ''),
  ];

  return CTRFReportSchema.parse({
    results: {
      tool: { name: 'warden-load' },
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
 * Pure gate mapping over the CTRF output of {@link k6LoadResultsToCtrf}: any breached threshold
 * (p95, p99, or error rate) → `BLOCK`, otherwise `PASS`. Load thresholds have no "acceptable
 * degradation" tier the way a11y/perf budgets do, so there is no `WARN` outcome here.
 */
export function evaluateLoadGate(report: CTRFReport): GateDecision {
  const failed = report.results.tests.filter((t) => t.status === 'failed');
  if (failed.length > 0) {
    return {
      decision: 'BLOCK',
      reason: `${failed.length} load threshold(s) breached: ${failed.map((t) => t.name).join(', ')}`,
    };
  }
  return { decision: 'PASS', reason: 'all load thresholds within budget' };
}

/** Injected config driving {@link runK6Load}; mirrors `cfg.load` in `warden.config`. */
export interface K6LoadConfig {
  /** Path to the k6 script to run. */
  script: string;
  /** Number of virtual users. */
  vus: number;
  /** Test duration, in seconds. */
  durationSec: number;
  thresholds: K6LoadThresholds;
}

/** Options for {@link runK6Load}. */
export interface RunK6LoadOptions {
  /** Working directory to run k6 in. Defaults to the current process cwd. */
  cwd?: string;
  /** Extra environment variables (surfaced to the script as `__ENV`). */
  env?: Record<string, string>;
}

/** Result of a {@link runK6Load} run: the normalized summary, its CTRF report, and the gate. */
export interface RunK6LoadResult {
  summary: K6LoadSummary;
  report: CTRFReport;
  gate: GateDecision;
}

/** The structural subset of k6's end-of-test summary JSON this tier reads. */
interface K6RawSummary {
  metrics?: Record<string, { values?: Record<string, number> }>;
}

/**
 * Integration glue that shells out to the `k6` binary. NOT unit-tested (it spawns a child process
 * and drives a real load test). Runs `k6 run --vus --duration --summary-export`, reads the
 * exported summary, normalizes it to a {@link K6LoadSummary}, converts it to CTRF via
 * {@link k6LoadResultsToCtrf}, and evaluates the gate via {@link evaluateLoadGate}.
 */
export function runK6Load(
  cfg: K6LoadConfig,
  opts: RunK6LoadOptions = {},
): Promise<RunK6LoadResult> {
  const dir = mkdtempSync(join(tmpdir(), 'warden-k6-load-'));
  const summaryPath = join(dir, 'summary.json');
  const args = [
    'run',
    `--vus=${cfg.vus}`,
    `--duration=${cfg.durationSec}s`,
    `--summary-export=${summaryPath}`,
    cfg.script,
  ];

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
        reject(new BrowserError(`k6 load run produced no summary export. stderr: ${stderr}`));
      }
    });
  }).then(() => {
    let raw: K6RawSummary;
    try {
      raw = JSON.parse(readFileSync(summaryPath, 'utf8')) as K6RawSummary;
    } catch (err) {
      throw new BrowserError(`failed to parse k6 load summary export: ${(err as Error).message}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const summary: K6LoadSummary = {
      p95Ms: raw.metrics?.http_req_duration?.values?.['p(95)'] ?? 0,
      p99Ms: raw.metrics?.http_req_duration?.values?.['p(99)'] ?? 0,
      errorRate: raw.metrics?.http_req_failed?.values?.rate ?? 0,
      requests: raw.metrics?.http_reqs?.values?.count ?? 0,
    };
    const report = k6LoadResultsToCtrf(summary, cfg.thresholds);
    return { summary, report, gate: evaluateLoadGate(report) };
  });
}
