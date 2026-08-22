import {
  WardenError,
  defineConfig,
  type CTRFReport,
  type GateDecision,
  type GateReport,
  type GateReportFailure,
  type ReportContext,
  type TestExecution,
  type VcsProvider,
  type VcsRepoRef,
  type WardenConfig,
} from '@warden/core';
import {
  CheckRunReporter,
  PrCommentReporter,
  VcsCheckReporter,
  VcsCommentReporter,
  aggregate,
  computeGateDecision,
  type OctokitChecksClient,
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
  /**
   * Required: the octokit-shaped client the PR comment and the check run are posted through.
   * Never real in tests. `checks` is part of the shape because the check run is the only thing
   * GitHub can turn into a required status — a comment blocks nothing.
   */
  octokit?: OctokitIssuesClient & OctokitChecksClient;
  /** Required: the `{ owner, repo }` the PR comment is posted to. */
  repo?: NonNullable<ReportContext['repo']>;
  /**
   * A configured multi-SCM `VcsProvider` (non-GitHub hosts). When present, the comment — and,
   * when `headSha` is known, the status — route through the provider instead of `octokit`.
   */
  vcs?: VcsProvider;
  /** The host-agnostic repo ref used with `deps.vcs`. Required when `deps.vcs` is set. */
  repoRef?: VcsRepoRef;
  /** Injected in tests instead of `@warden/reporter`'s `aggregate`. */
  aggregate?: (reportsDir: string) => Promise<CTRFReport>;
  headSha?: string;
}

/** Return value of {@link runReport}. */
export interface RunReportResult {
  report: CTRFReport;
  execution: TestExecution;
  gate: GateDecision;
  /**
   * The process exit code this gate decision demands: `1` for `BLOCK`, `0` otherwise. Lives on
   * the result rather than in `bin/warden.ts` so the CI contract documented in `docs/cli.md`
   * ("1 = gate decision BLOCK") is covered by a test instead of by one unexamined line.
   */
  exitCode: 0 | 1;
}

/**
 * Aggregates every CTRF report under `opts.reports` into one, converts it into a
 * `TestExecution`, derives a `GateDecision`, and posts it to the PR: a gate comment via a
 * `PrCommentReporter`, plus — when `reporting.checkRunAnnotations` is on and a head SHA is
 * known — a check run via a `CheckRunReporter`, which is the half a required status can read.
 * The returned `exitCode` is the caller's obligation: `1` when the gate blocks.
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
  const gate = computeGateDecision(execution, cfg.gates);
  // A blocked gate that exits 0 is worse than no gate at all: the CI step it runs in goes green.
  const exitCode: 0 | 1 = gate.decision === 'BLOCK' ? 1 : 0;

  // Multi-SCM path: route the comment (and status, when `headSha` is known) through the
  // configured `VcsProvider`. Used for non-GitHub hosts; GitHub keeps the direct octokit path.
  if (deps.vcs) {
    if (!deps.repoRef) {
      throw new WardenError(
        'runReport requires deps.repoRef when deps.vcs is set.',
        'CLI_MISSING_REPO',
      );
    }
    const ctx: ReportContext = {
      config: cfg,
      artifactsDir: opts.artifactsDir ?? opts.reports,
      prNumber: opts.pr,
      // `warden report` aggregates CTRF only: no a11y, performance or CUJ tier ran here, so the
      // gate the reporters publish is this one. Passed explicitly rather than left to each
      // reporter's own fallback, so the posted verdict and the returned one are one value.
      gate,
      repo: {
        owner: deps.repoRef.owner,
        repo: deps.repoRef.repo,
        host: deps.repoRef.host,
        ...(deps.repoRef.project ? { project: deps.repoRef.project } : {}),
      },
      ...(deps.headSha !== undefined && { headSha: deps.headSha }),
    };
    await new VcsCommentReporter(deps.vcs).report(execution, ctx);
    if (deps.headSha !== undefined) {
      await new VcsCheckReporter(deps.vcs).report(execution, ctx);
    }
    return { report, execution, gate, exitCode };
  }

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
    gate,
    repo: deps.repo,
    ...(deps.headSha !== undefined && { headSha: deps.headSha }),
  };
  await reporter.report(execution, ctx);

  // The check run is what a branch protection rule can require; the comment is only a message.
  // Without it a BLOCK on GitHub produced a red-looking comment beside a green required check.
  // It needs a head SHA to attach to (`--head-sha`, else $GITHUB_SHA); when none is known the
  // run is skipped rather than attached to a guessed commit, and the non-zero exit code
  // remains the guard.
  if (cfg.reporting.checkRunAnnotations && deps.headSha !== undefined) {
    await new CheckRunReporter(deps.octokit).report(execution, ctx);
  }

  return { report, execution, gate, exitCode };
}

/**
 * Projects a finished report run onto the `GateReport` a CI host reads from
 * `warden report aggregate --json`.
 *
 * The counts come from the merged CTRF summary rather than from `execution.results`, because
 * that is the number the same run's human line and PR comment are built from — a reader must
 * never see the action's header disagree with the comment beneath it.
 */
export function toGateReport(result: RunReportResult): GateReport {
  const summary = result.report.results.summary;
  const failures: GateReportFailure[] = [];
  for (const test of result.report.results.tests) {
    if (test.status !== 'failed') continue;
    // A failure with no file cannot be annotated against the diff; it is still counted in the
    // summary, so dropping it here loses no information the reader had a use for.
    if (!test.filePath) continue;
    failures.push({
      path: test.filePath,
      message: test.message ?? 'test failed',
      title: test.name,
      // A test that failed is not a warning about one. The field stays optional on the type
      // so a host reading a report without it can still derive its own level.
      annotation_level: 'failure',
    });
  }

  return {
    gate: { decision: result.gate.decision, reason: result.gate.reason },
    summary: { total: summary.tests, passed: summary.passed, failed: summary.failed },
    ...(failures.length > 0 && { failures }),
  };
}
