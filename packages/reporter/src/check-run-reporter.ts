import { WardenError, type Reporter, type ReportContext, type TestExecution } from '@warden/core';
import { computeGateDecision } from './gate-decision.js';
import type { CheckRunAnnotation, OctokitChecksClient } from './octokit-like.js';
import { renderPrReport } from './pr-report.js';

/** Builds and creates a GitHub Check Run whose annotations point at failed tests. */
export class CheckRunReporter implements Reporter {
  readonly name = 'check-run';

  constructor(private readonly octokit: OctokitChecksClient) {}

  async report(execution: TestExecution, ctx: ReportContext): Promise<void> {
    if (!ctx.repo) {
      throw new WardenError('ctx.repo is required to create a check run', 'REPORTER_NO_REPO');
    }
    if (!ctx.headSha) {
      throw new WardenError(
        'ctx.headSha is required to create a check run',
        'REPORTER_NO_HEAD_SHA',
      );
    }

    const gate = computeGateDecision(execution);
    const summary = renderPrReport(execution, gate);

    const annotations: CheckRunAnnotation[] = execution.results
      .filter((result) => result.status === 'FAIL')
      .map((result) => ({
        path: result.tracePath ?? result.screenshotPath ?? result.testCaseId,
        start_line: 1,
        end_line: 1,
        annotation_level: 'failure',
        message: result.errorMessage ?? `${result.testCaseId} failed`,
        title: result.testCaseId,
      }));

    await this.octokit.checks.create({
      owner: ctx.repo.owner,
      repo: ctx.repo.repo,
      name: 'Warden QA',
      head_sha: ctx.headSha,
      status: 'completed',
      conclusion:
        gate.decision === 'BLOCK' ? 'failure' : gate.decision === 'WARN' ? 'neutral' : 'success',
      output: {
        title: 'Warden QA Report',
        summary,
        annotations,
      },
    });
  }
}
