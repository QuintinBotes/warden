import { WardenError, type Reporter, type VcsProvider, type WardenConfig } from '@warden/core';
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
      throw new WardenError(
        'a VcsProvider (deps.vcs) or octokit client is required when cfg.reporting.prComment is enabled',
        'REPORTER_MISSING_OCTOKIT',
      );
    }
  }

  if (cfg.reporting.checkRunAnnotations) {
    if (deps.vcs) {
      reporters.push(new VcsCheckReporter(deps.vcs));
    } else if (deps.octokit) {
      reporters.push(new CheckRunReporter(deps.octokit));
    } else {
      throw new WardenError(
        'a VcsProvider (deps.vcs) or octokit client is required when cfg.reporting.checkRunAnnotations is enabled',
        'REPORTER_MISSING_OCTOKIT',
      );
    }
  }

  return reporters;
}
