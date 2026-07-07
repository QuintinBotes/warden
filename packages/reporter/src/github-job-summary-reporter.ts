import { promises as fs } from 'node:fs';
import { WardenError, type Reporter, type ReportContext, type TestExecution } from '@warden/core';
import { computeGateDecision } from './gate-decision.js';
import { renderPrReport } from './pr-report.js';

/** Options for {@link GithubJobSummaryReporter}. */
export interface GithubJobSummaryReporterOptions {
  /** Overrides `process.env.GITHUB_STEP_SUMMARY` — required for hermetic tests. */
  filePath?: string;
}

/** Appends the PR-report Markdown to the GitHub Actions job summary file. */
export class GithubJobSummaryReporter implements Reporter {
  readonly name = 'github-job-summary';

  constructor(private readonly opts: GithubJobSummaryReporterOptions = {}) {}

  async report(execution: TestExecution, _ctx: ReportContext): Promise<void> {
    const filePath = this.opts.filePath ?? process.env.GITHUB_STEP_SUMMARY;
    if (!filePath) {
      throw new WardenError(
        'GITHUB_STEP_SUMMARY is not set and no filePath was provided',
        'REPORTER_NO_SUMMARY_PATH',
      );
    }

    const gate = computeGateDecision(execution);
    const markdown = renderPrReport(execution, gate);
    await fs.appendFile(filePath, `${markdown}\n`, 'utf-8');
  }
}
