import {
  WardenError,
  defineConfig,
  type CTRFReport,
  type GateDecision,
  type ReportContext,
  type TestExecution,
  type WardenConfig,
} from '@warden/core';
import {
  PrCommentReporter,
  aggregate,
  computeGateDecision,
  type OctokitIssuesClient,
} from '@warden/reporter';
import { ctrfToExecution } from './ctrf-execution';

/** Options for {@link runReport}. */
export interface RunReportOptions {
  /** Directory of CTRF report JSON files to merge (`warden report aggregate --reports <dir>`). */
  reports: string;
  /** The pull request number to post the gate comment on. */
  pr: number;
  /** Directory recorded in the `ReportContext` handed to the reporter. Defaults to `reports`. */
  artifactsDir?: string;
}

/** Collaborators {@link runReport} can use instead of a real filesystem/GitHub. */
export interface RunReportDeps {
  /** Injected in tests instead of loading `warden.config.*` from disk. */
  config?: WardenConfig;
  /** Required: the octokit-shaped client the PR comment is posted through. Never real in tests. */
  octokit?: OctokitIssuesClient;
  /** Required: the `{ owner, repo }` the PR comment is posted to. */
  repo?: NonNullable<ReportContext['repo']>;
  /** Injected in tests instead of `@warden/reporter`'s `aggregate`. */
  aggregate?: (reportsDir: string) => Promise<CTRFReport>;
  headSha?: string;
}

/** Return value of {@link runReport}. */
export interface RunReportResult {
  report: CTRFReport;
  execution: TestExecution;
  gate: GateDecision;
}

/**
 * Aggregates every CTRF report under `opts.reports` into one, converts it into a
 * `TestExecution`, derives a `GateDecision`, and posts the gate comment to the PR via a
 * `PrCommentReporter` built from the injected octokit client.
 */
export async function runReport(
  opts: RunReportOptions,
  deps: RunReportDeps = {},
): Promise<RunReportResult> {
  const cfg = deps.config ?? defineConfig();
  const aggregateFn = deps.aggregate ?? aggregate;

  const report = await aggregateFn(opts.reports);
  const execution = ctrfToExecution(report, {
    triggerRef: String(opts.pr),
    triggerType: 'pr',
  });
  const gate = computeGateDecision(execution);

  if (!deps.octokit) {
    throw new WardenError(
      'runReport requires an injected octokit client (deps.octokit) to post the PR comment.',
      'CLI_MISSING_OCTOKIT',
    );
  }
  if (!deps.repo) {
    throw new WardenError(
      'runReport requires deps.repo ({ owner, repo }) to post the PR comment.',
      'CLI_MISSING_REPO',
    );
  }

  const reporter = new PrCommentReporter(deps.octokit);
  const ctx: ReportContext = {
    config: cfg,
    artifactsDir: opts.artifactsDir ?? opts.reports,
    prNumber: opts.pr,
    repo: deps.repo,
    ...(deps.headSha !== undefined && { headSha: deps.headSha }),
  };
  await reporter.report(execution, ctx);

  return { report, execution, gate };
}
