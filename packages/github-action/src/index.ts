/**
 * `warden-action` — the Warden AI QA GitHub Action.
 *
 * Public API (barrel). When this module is executed as the Action entry
 * (`dist/index.js`, per `action.yml`), it self-invokes `main()`. When it is
 * merely imported (e.g. by tests), the guard keeps it inert.
 */
import { pathToFileURL } from 'node:url';
import { main } from './run.js';

export { run, main } from './run.js';
export { loadPrEvent, resolveRepo } from './event.js';
export type { PrContext } from './event.js';
export { parseGithubOutput, parseAggregateReport } from './parse.js';
export type { AggregateReport, AggregateFailure, AggregateSummary } from './parse.js';
export { renderPrReport, buildAnnotations, gateToConclusion, checkTitle } from './report.js';
export type { PrReportInput } from './report.js';
export {
  analyze as wardenAnalyze,
  runTier as wardenRunTier,
  runAgent as wardenRunAgent,
  aggregate as wardenAggregate,
  CLI_LAUNCHER,
} from './warden-cli.js';
export {
  defaultExec,
  defaultFs,
  resolveCore,
  resolveOctokit,
  makeThrowingOctokit,
} from './defaults.js';
export type {
  ActionDeps,
  ActionsCoreLike,
  ActionsSummaryLike,
  CheckAnnotation,
  CreateCheckParams,
  CreateCommentParams,
  ExecFn,
  ExecOptions,
  ExecResult,
  FsLike,
  GateVerdict,
  OctokitLike,
  RunResult,
} from './types.js';

/** True when this module is the process entry point (the compiled Action). */
function isEntrypoint(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return import.meta.url === pathToFileURL(argv1).href;
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  void main();
}
