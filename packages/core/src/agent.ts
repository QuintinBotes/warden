import type { LLMProvider } from './llm';
import type { BrowserSession } from './browser';
import type { DiffFile, ChangeSurface } from './change-surface';
import type { WardenConfig } from './config';
import type { FixtureCatalog } from './data-fixtures';
import type { Cuj } from './cuj';

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
  /** Run-scoped seeded data the exploratory/generative strategies should reference. */
  fixtures?: FixtureCatalog;
  /** When set, the exploratory strategy treats this journey as its mission brief. */
  cuj?: Cuj;
}

export interface AgentOutput {
  findings: ExploratoryFinding[];
  generatedFiles?: GeneratedFile[];
  diagnosis?: HealerDiagnosis;
  markdownReport: string;
  /**
   * `LLMProvider.name` of the provider that produced this output — `"anthropic"`, `"openai"`,
   * `"gemini"`, `"ollama"`, or `"stub"` for a `--stub-provider` run that called no model.
   * Optional because a strategy invoked directly does not set it; `warden agent` always does.
   * Without it, an empty `findings` array cannot be told apart from a run that never happened.
   */
  provider?: string;
}

export interface AgentStrategy {
  name: StrategyName;
  run(input: AgentInput): Promise<AgentOutput>;
}
