import {
  WardenError,
  type Reporter,
  type ReportContext,
  type TestExecution,
  type VcsCheckState,
  type VcsProvider,
} from '@warden/core';
import { computeGateDecision } from './gate-decision.js';
import { renderPrReport } from './pr-report.js';
import { repoRefFromContext } from './vcs-comment-reporter.js';

const CONTEXT = 'warden-qa';

/**
 * Posts the merge-gate decision as a commit status through the configured {@link VcsProvider} —
 * a GitHub Check Run, a GitLab commit status, a Bitbucket build status, or an Azure DevOps PR
 * status. Same gate logic as `CheckRunReporter`, but no per-line file annotations (host
 * lowest-common-denominator — annotations stay a GitHub-only capability of `CheckRunReporter`).
 */
export class VcsCheckReporter implements Reporter {
  readonly name = 'vcs-check';

  constructor(private readonly provider: VcsProvider) {}

  async report(execution: TestExecution, ctx: ReportContext): Promise<void> {
    if (!ctx.headSha) {
      throw new WardenError('ctx.headSha is required to post a status', 'REPORTER_NO_HEAD_SHA');
    }
    const repo = repoRefFromContext(ctx, this.provider);
    const gate = computeGateDecision(execution);
    const summary = renderPrReport(execution, gate);
    const state: VcsCheckState =
      gate.decision === 'BLOCK' ? 'failure' : gate.decision === 'WARN' ? 'neutral' : 'success';

    await this.provider.postStatus(repo, ctx.headSha, {
      context: CONTEXT,
      state,
      title: 'Warden QA Report',
      summary,
    });
  }
}
