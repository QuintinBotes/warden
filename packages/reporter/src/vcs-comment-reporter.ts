import {
  WardenError,
  type Reporter,
  type ReportContext,
  type TestExecution,
  type VcsProvider,
  type VcsRepoRef,
} from '@warden/core';
import { computeGateDecision } from './gate-decision.js';
import { renderPrReport } from './pr-report.js';

/** Builds the host-agnostic {@link VcsRepoRef} a `VcsProvider` call needs from a report context. */
export function repoRefFromContext(ctx: ReportContext, provider: VcsProvider): VcsRepoRef {
  if (!ctx.repo) {
    throw new WardenError('ctx.repo is required to target a VcsProvider', 'REPORTER_NO_REPO');
  }
  const project = ctx.repo.project ?? ctx.config.vcs.project;
  return {
    host: ctx.repo.host ?? provider.host,
    owner: ctx.repo.owner,
    repo: ctx.repo.repo,
    ...(project ? { project } : {}),
  };
}

/**
 * Posts the PR-report Markdown as a comment through the configured {@link VcsProvider} — a PR
 * comment on GitHub, an MR note on GitLab, a PR comment on Bitbucket, or a PR thread comment on
 * Azure DevOps. Same `renderPrReport`/`computeGateDecision` logic as `PrCommentReporter`.
 */
export class VcsCommentReporter implements Reporter {
  readonly name = 'vcs-comment';

  constructor(private readonly provider: VcsProvider) {}

  async report(execution: TestExecution, ctx: ReportContext): Promise<void> {
    if (ctx.prNumber === undefined) {
      throw new WardenError(
        'ctx.prNumber is required to post a PR comment',
        'REPORTER_NO_PR_NUMBER',
      );
    }
    const repo = repoRefFromContext(ctx, this.provider);
    const gate = computeGateDecision(execution);
    const body = renderPrReport(execution, gate);
    await this.provider.postComment(repo, ctx.prNumber, body);
  }
}
