/**
 * Production defaults for the injectable collaborators. These are only reached
 * when `run()` is called without a given dep (i.e. inside a real GitHub Action).
 * Unit tests always inject fakes, so none of this code runs under test.
 *
 * `@actions/core` and `@octokit/rest` are imported dynamically so that merely
 * importing the action's public API (e.g. in tests) never pulls the toolkit.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { ConfigError } from '@warden/core';
import type { ActionsCoreLike, ExecFn, FsLike, OctokitLike } from './types.js';

const execFileAsync = promisify(execFile);

/** Default runner: `execFile` (argv array, no shell) promisified to `{ stdout, stderr }`. */
export const defaultExec: ExecFn = async (command, args, options) => {
  const { stdout, stderr } = await execFileAsync(command, args, {
    env: options?.env,
    cwd: options?.cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
};

/** Default filesystem: Node's synchronous `readFileSync`. */
export const defaultFs: FsLike = {
  readFileSync: (path, encoding) => readFileSync(path, encoding),
};

/** Resolve `@actions/core` (dynamically, so tests never load it). */
export async function resolveCore(core?: ActionsCoreLike): Promise<ActionsCoreLike> {
  if (core) return core;
  const mod = await import('@actions/core');
  return mod as unknown as ActionsCoreLike;
}

/**
 * An octokit whose GitHub calls reject with a helpful `ConfigError`. Used as the
 * default when no client is injected and no `GITHUB_TOKEN` is available — hence
 * "thrown-if-unset".
 */
export function makeThrowingOctokit(): OctokitLike {
  const fail = (): Promise<never> =>
    Promise.reject(
      new ConfigError(
        'Warden: no GitHub client available. Provide `GITHUB_TOKEN` (or inject an octokit) ' +
          'so the action can post the PR comment and check run.',
      ),
    );
  return {
    issues: { createComment: fail },
    checks: { create: fail },
  };
}

/**
 * Resolve an octokit client: use the injected one, else build a real client from
 * `GITHUB_TOKEN`, else a throwing stub.
 */
export async function resolveOctokit(
  octokit: OctokitLike | undefined,
  env: NodeJS.ProcessEnv,
): Promise<OctokitLike> {
  if (octokit) return octokit;
  const token = env.GITHUB_TOKEN ?? env.INPUT_GITHUB_TOKEN;
  if (!token) return makeThrowingOctokit();
  const { Octokit } = await import('@octokit/rest');
  return new Octokit({ auth: token }) as unknown as OctokitLike;
}
