import { spawn } from 'node:child_process';
import {
  BrowserError,
  CTRFReportSchema,
  type CTRFReport,
  type CTRFTest,
  type GateDecision,
} from '@warden/core';

/**
 * Component-testing glue, shaped exactly like `perf/k6.ts` / `security/zap.ts` / `a11y/axe.ts`:
 * the pure converter {@link componentResultsToCtrf} (runner results → CTRF) and the pure gate
 * helper {@link evaluateComponentGate} are unit-tested; {@link runComponentTests}, which shells
 * out to Playwright's component-test runner or Storybook's `test-storybook`, is integration-only
 * and not unit-tested.
 */

/** A single component test result, normalized from either supported runner's native report. */
export interface ComponentTestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  file?: string;
  message?: string;
}

function countStatus(tests: CTRFTest[], status: CTRFTest['status']): number {
  return tests.filter((t) => t.status === status).length;
}

/**
 * Pure converter from normalized {@link ComponentTestResult}s to a {@link CTRFReport}. Each result
 * becomes one CTRF test with a 1:1 status mapping (`passed`/`failed`/`skipped`), carrying its
 * source file in `filePath` and any failure message through unchanged. Output is validated with
 * {@link CTRFReportSchema}.
 */
export function componentResultsToCtrf(results: ComponentTestResult[]): CTRFReport {
  const tests: CTRFTest[] = results.map((result) => {
    const test: CTRFTest = {
      name: result.name,
      status: result.status,
      duration: result.durationMs,
      tags: ['component'],
    };
    if (result.file) test.filePath = result.file;
    if (result.message) test.message = result.message;
    return test;
  });

  return CTRFReportSchema.parse({
    results: {
      tool: { name: 'warden-component' },
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
 * Pure gate mapping over the CTRF output of {@link componentResultsToCtrf}: any failed component
 * test → `BLOCK`, otherwise `PASS`. Component tests have no "acceptable degradation" tier the way
 * a11y/perf budgets do, so there is no `WARN` outcome here.
 */
export function evaluateComponentGate(report: CTRFReport): GateDecision {
  const failed = report.results.tests.filter((t) => t.status === 'failed');
  if (failed.length > 0) {
    return {
      decision: 'BLOCK',
      reason: `${failed.length} component test failure(s)`,
    };
  }
  return { decision: 'PASS', reason: 'no component test failures' };
}

/** Injected config driving {@link runComponentTests}; mirrors `cfg.component` in `warden.config`. */
export interface ComponentConfig {
  runner: 'playwright-ct' | 'storybook';
  /** Path to the runner's own config file (e.g. `playwright-ct.config.ts`, Storybook's config dir). */
  configPath?: string;
  /** Restrict the run to matching test/story titles. */
  grep?: string;
}

/** Options for {@link runComponentTests}. */
export interface RunComponentOptions {
  /** Working directory to run the underlying CLI in. Defaults to the current process cwd. */
  cwd?: string;
  /** Path the CLI writes its JSON report to (relative to `cwd`). Defaults per-runner. */
  reportPath?: string;
  /** Override the underlying CLI command (defaults to `npx playwright` or `test-storybook`). */
  command?: string;
  /** Extra environment variables for the child process. */
  env?: Record<string, string>;
}

/** Result of a {@link runComponentTests} run: the normalized results, CTRF report, and gate. */
export interface RunComponentResult {
  results: ComponentTestResult[];
  report: CTRFReport;
  gate: GateDecision;
}

/** The structural subset of Playwright's `--reporter=json` output Warden reads. */
interface PlaywrightJsonSpec {
  title: string;
  file?: string;
  tests?: {
    results?: { status?: string; duration?: number; error?: { message?: string } }[];
  }[];
}
interface PlaywrightJsonSuite {
  file?: string;
  suites?: PlaywrightJsonSuite[];
  specs?: PlaywrightJsonSpec[];
}
interface PlaywrightJsonReport {
  suites?: PlaywrightJsonSuite[];
}

function playwrightStatus(status: string | undefined): ComponentTestResult['status'] {
  if (status === 'passed') return 'passed';
  if (status === 'skipped') return 'skipped';
  return 'failed'; // failed | timedOut | interrupted | undefined
}

function flattenPlaywrightSuite(suite: PlaywrightJsonSuite): ComponentTestResult[] {
  const results: ComponentTestResult[] = [];
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const last = (test.results ?? [])[test.results!.length - 1];
      results.push({
        name: spec.title,
        status: playwrightStatus(last?.status),
        durationMs: last?.duration ?? 0,
        file: spec.file ?? suite.file,
        message: last?.error?.message,
      });
    }
  }
  for (const nested of suite.suites ?? []) {
    results.push(...flattenPlaywrightSuite(nested));
  }
  return results;
}

/** Normalize Playwright's `--reporter=json` output into {@link ComponentTestResult}s. */
function playwrightJsonToComponentResults(json: unknown): ComponentTestResult[] {
  const report = (json ?? {}) as PlaywrightJsonReport;
  return (report.suites ?? []).flatMap(flattenPlaywrightSuite);
}

/** The structural subset of `@storybook/test-runner`'s `--json` (Jest-shaped) output Warden reads. */
interface StorybookJestAssertion {
  title?: string;
  fullName?: string;
  status?: string;
  duration?: number | null;
  failureMessages?: string[];
}
interface StorybookJestTestResult {
  testFilePath?: string;
  assertionResults?: StorybookJestAssertion[];
}
interface StorybookJsonReport {
  testResults?: StorybookJestTestResult[];
}

function storybookStatus(status: string | undefined): ComponentTestResult['status'] {
  if (status === 'passed') return 'passed';
  if (status === 'pending' || status === 'skipped' || status === 'todo') return 'skipped';
  return 'failed'; // failed | undefined
}

/** Normalize `test-storybook --json`'s Jest-shaped output into {@link ComponentTestResult}s. */
function storybookJsonToComponentResults(json: unknown): ComponentTestResult[] {
  const report = (json ?? {}) as StorybookJsonReport;
  const results: ComponentTestResult[] = [];
  for (const fileResult of report.testResults ?? []) {
    for (const assertion of fileResult.assertionResults ?? []) {
      results.push({
        name: assertion.fullName ?? assertion.title ?? 'unnamed story test',
        status: storybookStatus(assertion.status),
        durationMs: assertion.duration ?? 0,
        file: fileResult.testFilePath,
        message: assertion.failureMessages?.join('\n'),
      });
    }
  }
  return results;
}

/**
 * Integration glue that shells out to the configured component-test runner. NOT unit-tested (it
 * spawns a real child process and drives real component/story rendering). For `playwright-ct`,
 * runs `playwright test --reporter=json` (via `npx` unless overridden) with the JSON report
 * written to `reportPath`; for `storybook`, runs `test-storybook --json --outputFile=<reportPath>`.
 * Reads the resulting JSON, normalizes it via the runner-specific parser above, converts it to CTRF
 * via {@link componentResultsToCtrf}, and evaluates the gate via {@link evaluateComponentGate}.
 */
export function runComponentTests(
  cfg: ComponentConfig,
  opts: RunComponentOptions = {},
): Promise<RunComponentResult> {
  const cwd = opts.cwd ?? process.cwd();
  const isPlaywright = cfg.runner === 'playwright-ct';
  const reportPath =
    opts.reportPath ?? (isPlaywright ? 'playwright-ct-report.json' : 'storybook-test-report.json');

  const command = opts.command ?? (isPlaywright ? 'npx' : 'test-storybook');
  const args: string[] = [];
  const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env };

  if (isPlaywright) {
    args.push('playwright', 'test', '--reporter=json');
    if (cfg.configPath) args.push('-c', cfg.configPath);
    if (cfg.grep) args.push('--grep', cfg.grep);
    // Playwright's json reporter writes to stdout unless this env var names an output file.
    env.PLAYWRIGHT_JSON_OUTPUT_NAME = reportPath;
  } else {
    args.push('--json', `--outputFile=${reportPath}`);
    if (cfg.configPath) args.push('--config-dir', cfg.configPath);
    if (cfg.grep) args.push('--testNamePattern', cfg.grep);
  }

  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    // Both runners exit non-zero on a test failure but still write their JSON report, so we
    // resolve on close regardless of exit code and only fail if the report can't be read.
    child.on('close', () => {
      resolve();
      void stderr;
    });
  }).then(async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve: resolvePath } = await import('node:path');
    const abs = resolvePath(cwd, reportPath);
    let json: unknown;
    try {
      json = JSON.parse(await readFile(abs, 'utf8'));
    } catch (err) {
      throw new BrowserError(
        `failed to read ${cfg.runner} component-test JSON report: ${(err as Error).message}`,
      );
    }
    const results = isPlaywright
      ? playwrightJsonToComponentResults(json)
      : storybookJsonToComponentResults(json);
    const report = componentResultsToCtrf(results);
    return { results, report, gate: evaluateComponentGate(report) };
  });
}
