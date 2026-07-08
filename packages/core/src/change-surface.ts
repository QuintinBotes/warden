/**
 * Change-surface types — the output of the orchestrator's diff analysis (WS-10),
 * which decides which tests run and which AI tier fires for a given PR.
 */

/** One file in a git diff, as seen by the orchestrator. */
export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions?: number;
  deletions?: number;
  patch?: string;
}

export interface RiskReason {
  pattern: string;
  reason: string;
  score: number;
}

export interface ChangeSurface {
  changedFiles: string[];
  changedModules: string[]; // e.g. ['apps/checkout', 'lib/auth']
  testTags: string[]; // e.g. ['@apps/checkout', '@lib/auth']
  hasSharedChanges: boolean; // infra/shared changes → full suite
  affectedApiRoutes: string[];
  affectedComponents: string[];
  riskScore: number; // 1–10
  riskReasons: RiskReason[];
}

export type TestTier = 'smoke' | 'selective' | 'fullRegression' | 'aiExploratory' | 'api';

export interface GateDecision {
  decision: 'PASS' | 'WARN' | 'BLOCK';
  reason: string;
}
