import { spawn } from 'node:child_process';
import { BrowserError, type CTRFReport } from '@warden/core';
import { playwrightJsonToCtrf } from './playwright-ctrf';

/**
 * Integration glue that actually shells out to Playwright. This is intentionally NOT unit-tested
 * (it launches real browsers and a child process); the pure conversion it delegates to,
 * {@link playwrightJsonToCtrf}, is covered instead.
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
}

function shellPlaywright(opts: RunPlaywrightOptions): Promise<CTRFReport> {
  const args = ['playwright', 'test', '--reporter=json'];
  if (opts.grep) args.push('--grep', opts.grep);
  if (opts.configPath) args.push('--config', opts.configPath);

  return new Promise<string>((resolve, reject) => {
    const child = spawn('npx', args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
    });
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

/** Run Playwright browser tests and return a CTRF report. */
export function runPlaywright(opts: RunPlaywrightOptions = {}): Promise<CTRFReport> {
  return shellPlaywright(opts);
}

/** Run Playwright-driven API tests (defaults to the `@api` grep tag) and return a CTRF report. */
export function runApiTests(opts: RunPlaywrightOptions = {}): Promise<CTRFReport> {
  return shellPlaywright({ grep: '@api', ...opts });
}
