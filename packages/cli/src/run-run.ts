import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  loadConfig,
  type CTRFReport,
  type ReportContext,
  type Reporter,
  type TestExecution,
  type WardenConfig,
} from '@warden/core';
import { runPlaywright, type RunPlaywrightOptions } from '@warden/runner';
import { createReporters, type CreateReportersDeps } from '@warden/reporter';
import { ctrfToExecution } from './ctrf-execution';

/** Options for {@link runRun}. */
export interface RunRunOptions {
  /** Playwright `--grep` filter (e.g. a tier tag like `@smoke`). */
  grep?: string;
  /** Working directory tests run in. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Directory the CTRF report and reporter artifacts are written to. */
  artifactsDir: string;
}

/** Collaborators {@link runRun} can use instead of touching a real browser/GitHub. */
export interface RunRunDeps {
  /** Injected in tests instead of loading `warden.config.*` from disk. */
  config?: WardenConfig;
  /** Injected in tests instead of `@warden/runner`'s `runPlaywright`. */
  runTests?: (opts: { grep?: string; cwd?: string }) => Promise<CTRFReport>;
  /** Injected in tests instead of `createReporters(cfg)`. */
  reporters?: Reporter[];
  /** Forwarded to `createReporters` when `reporters` is not injected. */
  reporterDeps?: CreateReportersDeps;
  prNumber?: number;
  headSha?: string;
  repo?: ReportContext['repo'];
}

/** Return value of {@link runRun}. */
export interface RunRunResult {
  /** The raw CTRF report produced by the runner. */
  report: CTRFReport;
  /** The report converted into a Warden `TestExecution` and handed to each reporter. */
  execution: TestExecution;
  /** Where the CTRF report was written on disk. */
  ctrfPath: string;
}

/**
 * Runs tests via the injected (or real Playwright) runner, writes the resulting CTRF report to
 * `artifactsDir/ctrf-report.json`, converts it into a `TestExecution`, and hands that execution
 * to every reporter (injected, or selected from config via `createReporters`).
 */
export async function runRun(opts: RunRunOptions, deps: RunRunDeps = {}): Promise<RunRunResult> {
  const cwd = opts.cwd ?? process.cwd();
  const cfg = deps.config ?? (await loadConfig(cwd));
  const runTests = deps.runTests ?? ((runOpts: RunPlaywrightOptions) => runPlaywright(runOpts));

  const report = await runTests({ grep: opts.grep, cwd });

  await fs.mkdir(opts.artifactsDir, { recursive: true });
  const ctrfPath = path.join(opts.artifactsDir, 'ctrf-report.json');
  await fs.writeFile(ctrfPath, JSON.stringify(report, null, 2), 'utf-8');

  const execution = ctrfToExecution(report, {
    triggerRef: opts.grep ?? 'all',
    triggerType: 'manual',
  });

  const reporters = deps.reporters ?? createReporters(cfg, deps.reporterDeps);
  const ctx: ReportContext = {
    config: cfg,
    artifactsDir: opts.artifactsDir,
    ...(deps.prNumber !== undefined && { prNumber: deps.prNumber }),
    ...(deps.headSha !== undefined && { headSha: deps.headSha }),
    ...(deps.repo !== undefined && { repo: deps.repo }),
  };

  for (const reporter of reporters) {
    await reporter.report(execution, ctx);
  }

  return { report, execution, ctrfPath };
}
