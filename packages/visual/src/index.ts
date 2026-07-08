/**
 * `@warden/visual` — the visual-regression engine. Renders a `module × viewport × theme` matrix,
 * diffs each render against a Git-versioned baseline (deterministic pixel floor), and — in AI mode
 * — asks the configured provider to classify a pixel-confirmed change as meaningful vs render-noise.
 * Results flow into the gate, reporter, and dashboard as a `warden-visual` CTRF + `VisualFinding[]`.
 * Every collaborator is injected, so the whole engine is unit-testable without a live browser,
 * network, or LLM.
 */

export { planVisualChecks, plannedMatrixSize } from './plan-checks.js';
export { pixelDiff, type BoundingBox } from './pixel-diff.js';
export { PlaywrightVisualEngine } from './playwright-visual-engine.js';
export { createVisualEngine } from './create-visual-engine.js';
export {
  GitBaselineStore,
  nodeVisualFs,
  type VisualFs,
  type GitBaselineStoreOptions,
} from './git-baseline-store.js';
export { ProviderVisualJudge, type ProviderVisualJudgeOptions } from './provider-visual-judge.js';
export {
  compareCheck,
  keyOf,
  keySlug,
  type CompareCheckInput,
  type VisualArtifactSink,
} from './compare.js';
export { visualToCtrf, VISUAL_TOOL_NAME } from './to-ctrf.js';
export { visualToFindings, severityFor } from './to-findings.js';
export {
  approveBaseline,
  approveBranchName,
  type ApproveBaselineOptions,
  type ApproveBaselineResult,
} from './approve.js';
export { runVisualChecks, type RunVisualChecksInput, type RunVisualResult } from './run.js';
