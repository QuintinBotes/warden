import { WardenError, type Reporter, type WardenConfig } from '@warden/core';
import { CheckRunReporter } from './check-run-reporter.js';
import { CtrfReporter } from './ctrf-reporter.js';
import { GithubJobSummaryReporter } from './github-job-summary-reporter.js';
import type { OctokitChecksClient, OctokitIssuesClient } from './octokit-like.js';
import { PrCommentReporter } from './pr-comment-reporter.js';

/** Collaborators `createReporters` may need, injected so tests never touch a real GitHub. */
export interface CreateReportersDeps {
  octokit?: OctokitIssuesClient & OctokitChecksClient;
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
    if (!deps.octokit) {
      throw new WardenError(
        'an octokit client is required when cfg.reporting.prComment is enabled',
        'REPORTER_MISSING_OCTOKIT',
      );
    }
    reporters.push(new PrCommentReporter(deps.octokit));
  }

  if (cfg.reporting.checkRunAnnotations) {
    if (!deps.octokit) {
      throw new WardenError(
        'an octokit client is required when cfg.reporting.checkRunAnnotations is enabled',
        'REPORTER_MISSING_OCTOKIT',
      );
    }
    reporters.push(new CheckRunReporter(deps.octokit));
  }

  return reporters;
}
