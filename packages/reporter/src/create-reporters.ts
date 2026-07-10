import type { Logger, Reporter, VcsProvider, WardenConfig } from '@warden/core';
import { CheckRunReporter } from './check-run-reporter.js';
import { CtrfReporter } from './ctrf-reporter.js';
import { GithubJobSummaryReporter } from './github-job-summary-reporter.js';
import type { OctokitChecksClient, OctokitIssuesClient } from './octokit-like.js';
import { PrCommentReporter } from './pr-comment-reporter.js';
import { VcsCheckReporter } from './vcs-check-reporter.js';
import { VcsCommentReporter } from './vcs-comment-reporter.js';

/** Collaborators `createReporters` may need, injected so tests never touch a real GitHub. */
export interface CreateReportersDeps {
  octokit?: OctokitIssuesClient & OctokitChecksClient;
  /**
   * A configured multi-SCM `VcsProvider`. When present, `prComment` / `checkRunAnnotations`
   * select the host-agnostic `Vcs*` reporters instead of the Octokit-specific ones; when
   * absent, behavior is byte-for-byte unchanged (the existing GitHub-only `octokit` path).
   */
  vcs?: VcsProvider;
  /** Overrides `process.env.GITHUB_STEP_SUMMARY` for the job-summary reporter. */
  jobSummaryPath?: string;
  /** Warns when a GitHub-only reporter is enabled but no client is available (e.g. a local run). */
  logger?: Pick<Logger, 'warn'>;
}

/** Selects the `Reporter`s enabled by `cfg.reporting`. */
export function createReporters(cfg: WardenConfig, deps: CreateReportersDeps = {}): Reporter[] {
  const reporters: Reporter[] = [];

  if (cfg.reporting.ctrf) {
    reporters.push(new CtrfReporter());
  }

  if (cfg.reporting.githubJobSummary) {
    reporters.push(new GithubJobSummaryReporter({ filePath: deps.jobSummaryPath }));
  }

  if (cfg.reporting.prComment) {
    if (deps.vcs) {
      reporters.push(new VcsCommentReporter(deps.vcs));
    } else if (deps.octokit) {
      reporters.push(new PrCommentReporter(deps.octokit));
    } else {
      // No client (e.g. a local `warden run` without a token): skip the PR comment rather than
      // fail the whole run. In CI the Action always supplies an octokit, so nothing changes there.
      deps.logger?.warn(
        'reporting.prComment is enabled but no VcsProvider/octokit client was provided — skipping the PR comment.',
      );
    }
  }

  if (cfg.reporting.checkRunAnnotations) {
    if (deps.vcs) {
      reporters.push(new VcsCheckReporter(deps.vcs));
    } else if (deps.octokit) {
      reporters.push(new CheckRunReporter(deps.octokit));
    } else {
      deps.logger?.warn(
        'reporting.checkRunAnnotations is enabled but no VcsProvider/octokit client was provided — skipping the check run.',
      );
    }
  }

  return reporters;
}
