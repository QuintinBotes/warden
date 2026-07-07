import { WardenError, type Reporter, type ReportContext, type TestExecution } from '@warden/core';
import { computeGateDecision } from './gate-decision.js';
import type { OctokitIssuesClient } from './octokit-like.js';
import { renderPrReport } from './pr-report.js';

/** Posts the PR-report Markdown as an issue comment on the pull request. */
export class PrCommentReporter implements Reporter {
  readonly name = 'pr-comment';

  constructor(private readonly octokit: OctokitIssuesClient) {}

  async report(execution: TestExecution, ctx: ReportContext): Promise<void> {
    if (ctx.prNumber === undefined) {
      throw new WardenError(
        'ctx.prNumber is required to post a PR comment',
        'REPORTER_NO_PR_NUMBER',
      );
    }
    if (!ctx.repo) {
      throw new WardenError('ctx.repo is required to post a PR comment', 'REPORTER_NO_REPO');
    }

    const gate = computeGateDecision(execution);
    const body = renderPrReport(execution, gate);

    await this.octokit.issues.createComment({
      owner: ctx.repo.owner,
      repo: ctx.repo.repo,
      issue_number: ctx.prNumber,
      body,
    });
  }
}
