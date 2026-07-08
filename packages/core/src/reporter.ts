import type { WardenConfig } from './config';
import type { TestExecution } from './schema';
import type { VcsHost } from './vcs';

/**
 * Reporter abstraction. Each surface (CTRF JSON, GitHub Job Summary, PR comment,
 * Check-Run annotations) is a `Reporter`; the reporter package (WS-14) ships the V1 set
 * and `createReporters(cfg)` selects them from `cfg.reporting`.
 */

export interface ReportContext {
  config: WardenConfig;
  prNumber?: number;
  headSha?: string;
  /**
   * The repo the report targets. `host`/`project` are optional and only consulted by the
   * multi-SCM (`VcsProvider`) reporters — every existing GitHub `{ owner, repo }` literal
   * still type-checks. `project` carries the Azure DevOps project name.
   */
  repo?: { owner: string; repo: string; host?: VcsHost; project?: string };
  artifactsDir: string;
}

export interface Reporter {
  name: string;
  report(execution: TestExecution, ctx: ReportContext): Promise<void>;
}
