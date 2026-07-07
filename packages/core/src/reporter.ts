import type { WardenConfig } from './config';
import type { TestExecution } from './schema';

/**
 * Reporter abstraction. Each surface (CTRF JSON, GitHub Job Summary, PR comment,
 * Check-Run annotations) is a `Reporter`; the reporter package (WS-14) ships the V1 set
 * and `createReporters(cfg)` selects them from `cfg.reporting`.
 */

export interface ReportContext {
  config: WardenConfig;
  prNumber?: number;
  headSha?: string;
  repo?: { owner: string; repo: string };
  artifactsDir: string;
}

export interface Reporter {
  name: string;
  report(execution: TestExecution, ctx: ReportContext): Promise<void>;
}
