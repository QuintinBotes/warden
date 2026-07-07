import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Reporter, ReportContext, TestExecution } from '@warden/core';
import { executionToCtrf, type ExecutionToCtrfOptions } from './ctrf.js';

/** Writes the CTRF JSON report for an execution to `ctx.artifactsDir/ctrf-report.json`. */
export class CtrfReporter implements Reporter {
  readonly name = 'ctrf';

  constructor(private readonly opts: ExecutionToCtrfOptions = {}) {}

  async report(execution: TestExecution, ctx: ReportContext): Promise<void> {
    const report = executionToCtrf(execution, this.opts);
    await fs.mkdir(ctx.artifactsDir, { recursive: true });
    const filePath = path.join(ctx.artifactsDir, 'ctrf-report.json');
    await fs.writeFile(filePath, JSON.stringify(report, null, 2), 'utf-8');
  }
}
