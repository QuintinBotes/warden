import type { LLMProvider } from './llm';
import type { BrowserEngine } from './browser';
import type { Reporter } from './reporter';
import type { TestExecution, TestResult } from './schema';
import type { ExploratoryFinding } from './agent';
import type { GateDecision } from './change-surface';

/**
 * Plugin API — the extensibility surface, modeled on Vite's plugin system. Every
 * integration (Slack alerts, TestRail sync, custom providers) is a plugin, so extending
 * Warden is a config-level change, not a codebase change.
 */

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  headSha: string;
  baseSha: string;
  author?: string;
}

export interface QAPlatformPlugin {
  name: string;

  // Lifecycle hooks fired by the orchestrator
  onPROpened?: (pr: PullRequest) => Promise<void>;
  onTestExecutionStart?: (execution: TestExecution) => Promise<void>;
  onTestExecutionComplete?: (execution: TestExecution, results: TestResult[]) => Promise<void>;
  onBugFound?: (bug: ExploratoryFinding) => Promise<void>;
  onGateDecision?: (decision: GateDecision) => Promise<void>;

  // Override default behaviors
  overrideLLMProvider?: () => LLMProvider;
  overrideBrowserEngine?: () => BrowserEngine;
  overrideReporter?: () => Reporter;
}
