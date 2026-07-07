/**
 * Injection seams for the Warden GitHub Action.
 *
 * Every external collaborator the action touches — GitHub Actions toolkit (`core`),
 * the GitHub REST client (`octokit`), the child-process runner (`exec`), the
 * environment, and the filesystem — is expressed as a narrow interface here and
 * injected via {@link ActionDeps}. Unit tests pass fakes so the action runs with
 * NO network, NO real CLI subprocess, NO real GitHub, and NO real filesystem.
 */

/** The subset of the `@actions/core` summary API the action uses. */
export interface ActionsSummaryLike {
  addRaw(text: string, addEOL?: boolean): ActionsSummaryLike;
  write(options?: { overwrite?: boolean }): Promise<unknown>;
}

/** The subset of `@actions/core` the action uses. */
export interface ActionsCoreLike {
  getInput(name: string, options?: { required?: boolean }): string;
  setOutput(name: string, value: string): void;
  info(message: string): void;
  warning(message: string): void;
  error(message: string): void;
  setFailed(message: string): void;
  summary: ActionsSummaryLike;
}

/** Result of a shelled command. */
export interface ExecResult {
  stdout: string;
  stderr: string;
}

/** Options for a shelled command. */
export interface ExecOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/**
 * Runs a command with an argv array (never a shell string, to avoid injection).
 * Injected so tests can supply a fake that returns canned CLI output.
 */
export type ExecFn = (
  command: string,
  args: string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

/** The minimal filesystem surface the action needs (reading the event payload). */
export interface FsLike {
  readFileSync(path: string, encoding: 'utf8'): string;
}

/** Parameters for `octokit.issues.createComment`. */
export interface CreateCommentParams {
  owner: string;
  repo: string;
  issue_number: number;
  body: string;
}

/** A single GitHub Check-Run annotation (Surface 3). */
export interface CheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'failure' | 'warning' | 'notice';
  message: string;
  title?: string;
}

/** Parameters for `octokit.checks.create`. */
export interface CreateCheckParams {
  owner: string;
  repo: string;
  name: string;
  head_sha: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?:
    'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | 'skipped';
  output?: {
    title: string;
    summary: string;
    text?: string;
    annotations?: CheckAnnotation[];
  };
}

/** The subset of `@octokit/rest` the action uses. */
export interface OctokitLike {
  issues: { createComment(params: CreateCommentParams): Promise<unknown> };
  checks: { create(params: CreateCheckParams): Promise<unknown> };
}

/** Collaborators injected into {@link run}. All optional; production defaults are lazy. */
export interface ActionDeps {
  core?: ActionsCoreLike;
  octokit?: OctokitLike;
  exec?: ExecFn;
  env?: NodeJS.ProcessEnv;
  eventPath?: string;
  fs?: FsLike;
}

/** The decision half of a {@link import('@warden/core').GateDecision}. */
export type GateVerdict = 'PASS' | 'WARN' | 'BLOCK';

/** What {@link run} returns — useful for tests and programmatic callers. */
export interface RunResult {
  gate: GateVerdict;
  riskScore: number;
  reportPath: string;
  testTags: string;
  ranAgent: boolean;
  commentPosted: boolean;
  checkRunCreated: boolean;
  skipped: boolean;
}
