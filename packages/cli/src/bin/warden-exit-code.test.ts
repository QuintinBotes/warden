import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The built `bin/warden.js` — the artifact a user actually runs via `npx warden`. The rest of
 * this suite already depends on a build (every `@warden/*` import resolves to `dist`), so
 * asserting on the real binary adds no new precondition, and it is the only place the CLI's
 * exit code exists at all.
 */
const BIN = fileURLToPath(new URL('../../dist/bin/warden.js', import.meta.url));

/** A CTRF report with one passed and one failed test — enough for `computeGateDecision` to BLOCK. */
const FAILING_CTRF = JSON.stringify({
  results: {
    tool: { name: 'playwright' },
    summary: {
      tests: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      pending: 0,
      other: 0,
      start: 1,
      stop: 2,
    },
    tests: [
      { name: 'checkout works', status: 'passed', duration: 10 },
      { name: 'login works', status: 'failed', duration: 10, message: 'boom' },
    ],
  },
});

const PASSING_CTRF = JSON.stringify({
  results: {
    tool: { name: 'playwright' },
    summary: {
      tests: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      pending: 0,
      other: 0,
      start: 1,
      stop: 2,
    },
    tests: [{ name: 'checkout works', status: 'passed', duration: 10 }],
  },
});

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runWarden(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('warden report aggregate exit code', () => {
  let server: Server;
  let baseUrl: string;
  let cwd: string;
  let requestedPaths: string[];

  // A real HTTP server standing in for the GitLab API: the command must post its comment and
  // status successfully, so that a non-zero exit can only come from the gate decision.
  beforeAll(async () => {
    server = createServer((req, res) => {
      requestedPaths.push(req.url ?? '');
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address === 'string' || address === null) throw new Error('no server port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  beforeEach(async () => {
    requestedPaths = [];
    cwd = await fs.mkdtemp(path.join(tmpdir(), 'warden-exit-code-'));
    await fs.mkdir(path.join(cwd, 'reports'));
    await fs.writeFile(
      path.join(cwd, 'warden.config.mjs'),
      `export default { vcs: { provider: 'gitlab', baseUrl: ${JSON.stringify(baseUrl)} } };\n`,
      'utf-8',
    );
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  const gitlabEnv = {
    GITLAB_TOKEN: 'test-token',
    CI_PROJECT_PATH: 'acme/app',
    CI_COMMIT_SHA: 'deadbeef',
  };

  it('exits 1 when the gate blocks', async () => {
    await fs.writeFile(path.join(cwd, 'reports', 'smoke.ctrf.json'), FAILING_CTRF, 'utf-8');

    const result = await runWarden(
      cwd,
      ['report', 'aggregate', '--reports', './reports', '--pr', '7'],
      gitlabEnv,
    );

    expect(result.stdout).toContain('gate: BLOCK');
    expect(result.code).toBe(1);
  });

  it('exits 0 when the gate passes', async () => {
    await fs.writeFile(path.join(cwd, 'reports', 'smoke.ctrf.json'), PASSING_CTRF, 'utf-8');

    const result = await runWarden(
      cwd,
      ['report', 'aggregate', '--reports', './reports', '--pr', '7'],
      gitlabEnv,
    );

    expect(result.stdout).toContain('gate: PASS');
    expect(result.code).toBe(0);
  });

  it('attaches the commit status to --head-sha rather than the CI merge commit', async () => {
    await fs.writeFile(path.join(cwd, 'reports', 'smoke.ctrf.json'), PASSING_CTRF, 'utf-8');

    // On a pull_request event the CI-provided SHA is the merge commit, and a required check is
    // read off the PR's head commit — so the flag has to win over the environment.
    await runWarden(
      cwd,
      ['report', 'aggregate', '--reports', './reports', '--pr', '7', '--head-sha', 'headcommit'],
      gitlabEnv,
    );

    expect(requestedPaths.some((url) => url.endsWith('/statuses/headcommit'))).toBe(true);
    expect(requestedPaths.some((url) => url.endsWith('/statuses/deadbeef'))).toBe(false);
  });
});
