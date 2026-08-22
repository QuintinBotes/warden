import type { GateDecision } from './change-surface';
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
  /**
   * The run's final merge-gate decision, after every tier has been folded in worst-of — test
   * results, flake quarantine, the a11y and performance budgets, and the CUJ gate. A reporter
   * publishes what a reviewer treats as the verdict, so it must publish *this* and not derive
   * one from `execution`, which carries test results only. Optional because the `Reporter`
   * contract is also driven by callers that have no gate beyond the tests (`warden report`);
   * those reporters fall back to `computeGateDecision(execution)`.
   */
  gate?: GateDecision;
}

export interface Reporter {
  name: string;
  report(execution: TestExecution, ctx: ReportContext): Promise<void>;
}
