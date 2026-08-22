import { spawn } from 'node:child_process';
import { BrowserError, type CTRFReport } from '@warden/core';
import { playwrightJsonToCtrf } from './playwright-ctrf';
import { resolvePlaywrightCli } from './playwright-cli';

/**
 * Integration glue that actually shells out to Playwright. Launching real browsers is not
 * unit-tested; which binary gets launched is — see `run-playwright.test.ts`, which drives a real
 * child process through a stand-in CLI on disk. The pure conversion this delegates to,
 * {@link playwrightJsonToCtrf}, is covered separately.
 */

export interface RunPlaywrightOptions {
  /** Playwright `--grep` filter (e.g. a tier tag like `@smoke`). */
  grep?: string;
  /** Working directory to run Playwright in. Defaults to the current process cwd. */
  cwd?: string;
  /** Path to a Playwright config file (`--config`). */
  configPath?: string;
  /** Tool version to stamp into the CTRF report. */
  toolVersion?: string;
  /** Extra environment variables for the child process. */
  env?: Record<string, string>;
  /**
   * Playwright `--shard` slice for this lane, e.g. `'3/8'` (from a grid `ShardAssignment`). Fans
   * the tier across N CI shards. Optional — omit for an unsharded run.
   */
  shard?: string;
  /**
   * Remote grid connect endpoint (a provider Playwright connect URL). Surfaced to the Playwright
   * config via `PLAYWRIGHT_CONNECT_WS_ENDPOINT` so a desktop lane drives the grid instead of a
   * local browser. Optional — omit for a local run.
   */
  connectUrl?: string;
}

function shellPlaywright(opts: RunPlaywrightOptions): Promise<CTRFReport> {
  const args = ['test', '--reporter=json'];
  if (opts.grep) args.push('--grep', opts.grep);
  if (opts.configPath) args.push('--config', opts.configPath);
  if (opts.shard) args.push('--shard', opts.shard);

  const gridEnv = opts.connectUrl ? { PLAYWRIGHT_CONNECT_WS_ENDPOINT: opts.connectUrl } : {};
  const env = { ...process.env, ...gridEnv, ...opts.env };
  const cwd = opts.cwd ?? process.cwd();
  // Resolved, never fetched: `npx playwright` installs the package when the repo has none, so a
  // repo that never asked for Playwright got one downloaded and a run that tested nothing.
  const cli = resolvePlaywrightCli(cwd, env);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(cli, args, { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    // Playwright exits non-zero when tests fail but still emits the JSON report on stdout, so we
    // resolve on close regardless of exit code and only fail if there is no JSON at all.
    child.on('close', () => {
      if (!stdout.trim()) {
        reject(new BrowserError(`playwright produced no JSON output. stderr: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  }).then((stdout) => {
    let json: unknown;
    try {
      json = JSON.parse(stdout);
    } catch (err) {
      throw new BrowserError(`failed to parse playwright JSON report: ${(err as Error).message}`);
    }
    return playwrightJsonToCtrf(json, { toolVersion: opts.toolVersion });
  });
}

/**
 * Run Playwright browser tests and return a CTRF report. Rejects with a {@link BrowserError} when
 * the project has no Playwright installed — Warden will not download one to fill the gap.
 */
export function runPlaywright(opts: RunPlaywrightOptions = {}): Promise<CTRFReport> {
  return runOrReject(opts);
}

/** Run Playwright-driven API tests (defaults to the `@api` grep tag) and return a CTRF report. */
export function runApiTests(opts: RunPlaywrightOptions = {}): Promise<CTRFReport> {
  return runOrReject({ grep: '@api', ...opts });
}

/** Keeps resolution failures on the returned promise rather than throwing synchronously. */
function runOrReject(opts: RunPlaywrightOptions): Promise<CTRFReport> {
  try {
    return shellPlaywright(opts);
  } catch (err) {
    return Promise.reject(err);
  }
}
