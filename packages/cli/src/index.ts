/**
 * `@warden/cli` (WS-20) — the `warden` CLI. Every command's logic lives in a plain,
 * dependency-injectable function here; `bin/warden.ts` is a thin Commander wrapper around
 * these exports.
 */

export { runAnalyze, type RunAnalyzeOptions, type RunAnalyzeDeps } from './run-analyze';
export { runRun, type RunRunOptions, type RunRunDeps, type RunRunResult } from './run-run';
export { runAgent, type RunAgentOptions, type RunAgentDeps } from './run-agent';
export {
  runReport,
  toGateReport,
  type RunReportOptions,
  type RunReportDeps,
  type RunReportResult,
} from './run-report';
export { runPlan, type RunPlanOptions } from './run-plan';
export { createOverwriteConfirm, type ConfirmIo } from './confirm-overwrite';
export {
  runInit,
  type InitFileOutcome,
  type InitFileStatus,
  type RunInitOptions,
  type RunInitResult,
} from './run-init';
export {
  runVisualApprove,
  type RunVisualApproveOptions,
  type RunVisualApproveDeps,
  type RunVisualApproveResult,
} from './run-visual';

export { ctrfToExecution, type CtrfToExecutionOptions } from './ctrf-execution';
export { createFetchOctokit, type FetchOctokitOptions } from './github-client';
export {
  createVcsProviderFromEnv,
  resolveVcsRepoRef,
  resolveVcsHeadSha,
  type EnvLike,
} from './vcs-client';

/**
 * The Commander surface itself. Exported so the flags the GitHub Action passes can be
 * asserted against the real parser rather than assumed.
 */
export { buildProgram } from './program';
