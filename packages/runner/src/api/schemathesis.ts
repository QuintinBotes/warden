import { spawn } from 'node:child_process';
import {
  BrowserError,
  CTRFReportSchema,
  type CTRFReport,
  type CTRFTest,
  type GateDecision,
  type SchemathesisCheckFailure,
  type SchemathesisEndpointResult,
  type SchemathesisReport,
} from '@warden/core';

/**
 * Schemathesis (OpenAPI property-based fuzzing) glue. The pure converter
 * {@link schemathesisJsonToCtrf} and the pure gate helper {@link evaluateSchemathesisGate} are
 * unit-tested; {@link runSchemathesis}, which shells out to the `schemathesis` CLI, is
 * integration-only and not unit-tested (its pure pieces are covered instead) — same split as
 * `perf/k6.ts` and `security/zap.ts`.
 */

/** Check names that represent a breaking API change: server error or schema/status drift. */
const BLOCKING_CHECKS = new Set([
  'not_a_server_error',
  'response_schema_conformance',
  'status_code_conformance',
]);

function countStatus(tests: CTRFTest[], status: CTRFTest['status']): number {
  return tests.filter((t) => t.status === status).length;
}

/**
 * Pure converter from a {@link SchemathesisReport} to a {@link CTRFReport}. Each endpoint with no
 * failures becomes one `passed` test; each failure becomes its own `failed` test tagged with the
 * endpoint's method/path and the failing check's name, carrying `checkName`, `example`, and
 * `seed` in `extra`. Output is validated with {@link CTRFReportSchema}.
 */
export function schemathesisJsonToCtrf(json: unknown): CTRFReport {
  const report = (json ?? {}) as SchemathesisReport;
  const tests: CTRFTest[] = [];

  for (const endpoint of report.endpoints ?? []) {
    const label = `${endpoint.method} ${endpoint.path}`;
    const failures: SchemathesisCheckFailure[] = endpoint.failures ?? [];

    if (failures.length === 0) {
      tests.push({
        name: label,
        status: 'passed',
        duration: 0,
        tags: [endpoint.method, endpoint.path, 'api'],
        extra: { checksRun: endpoint.checksRun },
      });
      continue;
    }

    for (const failure of failures) {
      const test: CTRFTest = {
        name: `${label} — ${failure.checkName}`,
        status: 'failed',
        duration: 0,
        message: failure.message,
        tags: [endpoint.method, endpoint.path, failure.checkName, 'api'],
        extra: {
          checkName: failure.checkName,
          example: failure.example,
          seed: failure.seed,
        },
      };
      tests.push(test);
    }
  }

  return CTRFReportSchema.parse({
    results: {
      tool: { name: 'schemathesis' },
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
 * Pure gate mapping for a Schemathesis run (the CTRF output of {@link schemathesisJsonToCtrf}).
 * Any failed test tagged with a server-error or schema/status-code conformance check → `BLOCK`;
 * any other failed check → `WARN`; a clean report → `PASS`.
 */
export function evaluateSchemathesisGate(report: CTRFReport): GateDecision {
  const failed = report.results.tests.filter((t) => t.status === 'failed');
  if (failed.length === 0) {
    return { decision: 'PASS', reason: 'no Schemathesis check failures' };
  }

  const blocking = failed.filter((t) => BLOCKING_CHECKS.has(String(t.extra?.checkName ?? '')));
  if (blocking.length > 0) {
    return {
      decision: 'BLOCK',
      reason: `${blocking.length} server-error or schema/status-code conformance failure(s)`,
    };
  }

  return {
    decision: 'WARN',
    reason: `${failed.length} Schemathesis check failure(s) outside server-error/conformance`,
  };
}

/** Options for {@link runSchemathesis}. */
export interface RunSchemathesisOptions {
  /** Working directory to run schemathesis in. Defaults to the current process cwd. */
  cwd?: string;
  /** Checks to run. Defaults to `config.api.schemathesis.checks`. */
  checks?: string[];
  /** Per-endpoint generated-example budget. Defaults to `config.api.schemathesis.maxExamplesPerEndpoint`. */
  maxExamples?: number;
  /** Path the CLI writes its JSON report to (relative to `cwd`). Defaults to `schemathesis-report.json`. */
  reportPath?: string;
  /** Override the CLI command (defaults to `schemathesis`). */
  command?: string;
  /** Extra environment variables for the child process. */
  env?: Record<string, string>;
}

/** Result of a {@link runSchemathesis} run: the CTRF report and the gate decision. */
export interface RunSchemathesisResult {
  report: CTRFReport;
  gate: GateDecision;
}

const DEFAULT_CHECKS = [
  'not_a_server_error',
  'response_schema_conformance',
  'status_code_conformance',
];

/**
 * Integration glue that shells out to the `schemathesis` CLI. NOT unit-tested (it fuzzes a live
 * OpenAPI schema over the network). Runs `schemathesis run <schemaUrl> --report=json`, reads the
 * JSON report, converts it via {@link schemathesisJsonToCtrf}, and evaluates the gate via
 * {@link evaluateSchemathesisGate}.
 */
export function runSchemathesis(
  schemaUrl: string,
  opts: RunSchemathesisOptions = {},
): Promise<RunSchemathesisResult> {
  const command = opts.command ?? 'schemathesis';
  const reportPath = opts.reportPath ?? 'schemathesis-report.json';
  const checks = opts.checks ?? DEFAULT_CHECKS;

  const args = ['run', schemaUrl, '--report=json', `--report-path=${reportPath}`];
  for (const check of checks) args.push('--check', check);
  if (opts.maxExamples !== undefined) args.push(`--max-examples=${opts.maxExamples}`);

  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    // schemathesis exits non-zero when checks fail but still writes the JSON report, so we
    // resolve on close regardless of exit code and let the report read fail if it's missing.
    child.on('close', () => {
      resolve();
      void stderr;
    });
  }).then(async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve: resolvePath } = await import('node:path');
    const abs = resolvePath(opts.cwd ?? process.cwd(), reportPath);
    let json: unknown;
    try {
      json = JSON.parse(await readFile(abs, 'utf8'));
    } catch (err) {
      throw new BrowserError(`failed to read Schemathesis JSON report: ${(err as Error).message}`);
    }
    const report = schemathesisJsonToCtrf(json);
    return { report, gate: evaluateSchemathesisGate(report) };
  });
}
