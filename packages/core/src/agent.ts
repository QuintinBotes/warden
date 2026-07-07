import type { LLMProvider } from './llm';
import type { BrowserSession } from './browser';
import type { DiffFile, ChangeSurface } from './change-surface';
import type { WardenConfig } from './config';

/**
 * Agent strategy abstraction. The three V1 strategies — exploratory (break it),
 * generative (write tests from the diff), healer (diagnose a failure) — implement
 * `AgentStrategy` (WS-11).
 */

export type StrategyName = 'exploratory' | 'generative' | 'healer';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface ExploratoryFinding {
  title: string;
  severity: Severity;
  steps: string[];
  expected: string;
  actual: string;
  screenshotPath?: string;
  requirementIds?: string[];
}

export interface GeneratedFile {
  path: string;
  content: string;
}

/** What the healer receives about a failed test. */
export interface FailureContext {
  testCode: string;
  errorMessage: string;
  stackTrace?: string;
  screenshotPath?: string;
  tracePath?: string;
}

export interface HealerDiagnosis {
  kind: 'regression' | 'maintenance';
  severity?: Severity;
  explanation: string;
  proposedFix?: string;
}

export interface AgentInput {
  provider: LLMProvider;
  browser?: BrowserSession;
  diff?: DiffFile[];
  changeSurface?: ChangeSurface;
  url?: string;
  failure?: FailureContext;
  config: WardenConfig;
}

export interface AgentOutput {
  findings: ExploratoryFinding[];
  generatedFiles?: GeneratedFile[];
  diagnosis?: HealerDiagnosis;
  markdownReport: string;
}

export interface AgentStrategy {
  name: StrategyName;
  run(input: AgentInput): Promise<AgentOutput>;
}
