import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineConfig, type GateDecision, type WardenConfig } from '@warden/core';
import { buildProgram, type ProgramDeps } from './program';
import type { RunReportResult } from './run-report';
import type { RunRunResult } from './run-run';
import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CTRFReport } from '@warden/core';
import { fixtureExecution } from '@warden/core/testing';
import { executionToCtrf } from '@warden/reporter';

/** Captures what a command wrote, and what it left `process.exitCode` as. */
function harness(overrides: ProgramDeps = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const proc: { exitCode?: number | string | null | undefined } = {};
  const program = buildProgram({
    proc,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => err.push(chunk) },
    env: {},
    ...overrides,
  });
  const parse = (argv: string[]) => program.parseAsync(['node', 'warden', ...argv]);
  return { parse, proc, stdout: () => out.join(''), stderr: () => err.join('') };
}

/** A `runRun` that runs nothing and reports the gate it was handed. */
function fakeRunRun(gate: GateDecision) {
  return vi.fn(
    async () =>
      ({
        report: { results: { tests: [] } },
        execution: { results: [] },
        ctrfPath: '/tmp/warden-artifacts/ctrf-report.json',
        gate,
      }) as unknown as RunRunResult,
  );
}

/** A `runReport` that aggregates nothing, posts nothing, and reports the gate it was handed. */
function fakeRunReport(gate: GateDecision) {
  return vi.fn(
    async () =>
      ({
        report: { results: { tests: [] } },
        execution: { results: [] },
        gate,
      }) as unknown as RunReportResult,
  );
}

/** `loadConfig` without a disk read, for the `report aggregate` host branch under test. */
function fakeLoadConfig(cfg: Partial<WardenConfig> = {}) {
  return vi.fn(async () => ({ ...defineConfig(), ...cfg }) as WardenConfig);
}

describe('warden run', () => {
  it('exits non-zero when the gate blocks', async () => {
    const h = harness({
      runRun: fakeRunRun({ decision: 'BLOCK', reason: '1 test(s) failed' }),
    });

    await h.parse(['run', '--grep', '@smoke', '--artifacts-dir', '/tmp/warden-artifacts']);

    // The whole product promise: a BLOCK has to fail the CI step that produced it.
    expect(h.proc.exitCode).toBe(1);
  });

  it('says which gate decision failed the step', async () => {
    const h = harness({
      runRun: fakeRunRun({ decision: 'BLOCK', reason: '1 test(s) failed' }),
    });

    await h.parse(['run', '--artifacts-dir', '/tmp/warden-artifacts']);

    // A step whose last word is "wrote CTRF report to …" gives no reason for failing.
    expect(h.stdout()).toContain('gate: BLOCK — 1 test(s) failed');
  });

  it('leaves the exit code alone when the gate passes or only warns', async () => {
    for (const decision of ['PASS', 'WARN'] as const) {
      const h = harness({ runRun: fakeRunRun({ decision, reason: 'ok' }) });

      await h.parse(['run', '--artifacts-dir', '/tmp/warden-artifacts']);

      expect(h.proc.exitCode).toBeUndefined();
    }
  });

  it('still exits non-zero when the run itself throws', async () => {
    const h = harness({
      runRun: vi.fn(async () => {
        throw new Error('playwright exploded');
      }) as unknown as ProgramDeps['runRun'],
    });

    await expect(h.parse(['run', '--artifacts-dir', '/tmp/x'])).rejects.toThrow(
      'playwright exploded',
    );
    expect(h.proc.exitCode).toBe(1);
    expect(h.stderr()).toContain('warden: playwright exploded');
  });
});

describe('warden report aggregate', () => {
  it('exits non-zero when the gate blocks on the GitHub path', async () => {
    const h = harness({
      loadConfig: fakeLoadConfig(),
      runReport: fakeRunReport({ decision: 'BLOCK', reason: '1 test(s) failed' }),
      env: { GITHUB_TOKEN: 'x', GITHUB_REPOSITORY: 'acme/app', GITHUB_SHA: 'deadbeef' },
    });

    await h.parse(['report', 'aggregate', '--reports', './reports', '--pr', '1']);

    expect(h.stdout()).toContain('gate: BLOCK — 1 test(s) failed');
    expect(h.proc.exitCode).toBe(1);
  });

  it('exits non-zero when the gate blocks on a non-GitHub host', async () => {
    const h = harness({
      loadConfig: fakeLoadConfig({
        vcs: { provider: 'gitlab', baseUrl: 'http://127.0.0.1:8899' },
      } as Partial<WardenConfig>),
      runReport: fakeRunReport({ decision: 'BLOCK', reason: '1 test(s) failed' }),
      env: { GITLAB_TOKEN: 'x', CI_PROJECT_PATH: 'acme/app', CI_COMMIT_SHA: 'deadbeef' },
    });

    await h.parse(['report', 'aggregate', '--reports', './reports', '--pr', '1']);

    expect(h.proc.exitCode).toBe(1);
  });

  it('leaves the exit code alone when the gate passes', async () => {
    const h = harness({
      loadConfig: fakeLoadConfig(),
      runReport: fakeRunReport({ decision: 'PASS', reason: 'all green' }),
      env: { GITHUB_TOKEN: 'x', GITHUB_REPOSITORY: 'acme/app' },
    });

    await h.parse(['report', 'aggregate', '--reports', './reports', '--pr', '1']);

    expect(h.proc.exitCode).toBeUndefined();
  });
});

/**
 * The same contract from the other end: these drive the real command tree — the one the
 * installed binary parses `process.argv` with — and assert on `process.exitCode` itself
 * rather than on an injected seam, because that value *is* what the process exits with.
 * It is process-global, so every case captures and restores it.
 */
/** A one-test CTRF report that either passed or failed. */
function ctrf(status: 'PASS' | 'FAIL'): CTRFReport {
  return executionToCtrf(
    fixtureExecution({
      results: [{ testCaseId: 'TC-1', status, duration: 10, retries: 0, flakeFlag: false }],
    }),
  );
}

/**
 * A real HTTP server standing in for the code host, so `report aggregate` runs its whole
 * path — config load, aggregation, gate, comment POST — over a real socket. Answers every
 * request with a plausible GitLab note payload; the test cares only that the CLI got through.
 */
async function startStubHost(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 1, iid: 1 }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('stub host has no port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

describe('the warden CLI exit code carries the gate decision', () => {
  let dir: string;
  let previousExitCode: typeof process.exitCode;
  let previousCwd: string;
  let stdout: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'warden-exit-code-'));
    previousExitCode = process.exitCode;
    previousCwd = process.cwd();
    process.exitCode = undefined;
    stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    // The job-summary reporter appends to $GITHUB_STEP_SUMMARY when it is set — which it is,
    // inside CI. Point it at the temp dir so a test run never writes to the real job summary.
    vi.stubEnv('GITHUB_STEP_SUMMARY', path.join(dir, 'job-summary.md'));
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** Writes the reports dir and the config that points the CLI at the stub host. */
  async function seedAggregateRepo(hostUrl: string, status: 'PASS' | 'FAIL'): Promise<string> {
    const reports = path.join(dir, 'reports');
    await fs.mkdir(reports, { recursive: true });
    await fs.writeFile(path.join(reports, 'tier.json'), JSON.stringify(ctrf(status)), 'utf-8');
    // `report aggregate` loads the config from the process cwd, so the repo under test has to
    // be the cwd — the same way it is when someone runs `warden` in their checkout.
    await fs.writeFile(
      path.join(dir, 'warden.config.ts'),
      `export default { vcs: { provider: 'gitlab', baseUrl: '${hostUrl}' } };\n`,
      'utf-8',
    );
    process.chdir(dir);
    vi.stubEnv('GITLAB_TOKEN', 'stub-token');
    vi.stubEnv('CI_PROJECT_PATH', 'acme/checkout');
    return reports;
  }

  it('exits 1 when `report aggregate` blocks, so a CI step fails on a failing test', async () => {
    const host = await startStubHost();
    try {
      const reports = await seedAggregateRepo(host.url, 'FAIL');

      await buildProgram({}).parseAsync(
        ['report', 'aggregate', '--reports', reports, '--pr', '482'],
        { from: 'user' },
      );

      expect(stdout).toContain('gate: BLOCK');
      expect(process.exitCode).toBe(1);
    } finally {
      await host.close();
    }
  });

  it('exits 0 when `report aggregate` passes', async () => {
    const host = await startStubHost();
    try {
      const reports = await seedAggregateRepo(host.url, 'PASS');

      await buildProgram({}).parseAsync(
        ['report', 'aggregate', '--reports', reports, '--pr', '482'],
        { from: 'user' },
      );

      expect(stdout).toContain('gate: PASS');
      expect(process.exitCode).toBeUndefined();
    } finally {
      await host.close();
    }
  });

  it('exits 1 when `run` blocks, and says which decision it exited on', async () => {
    await buildProgram({ runTests: async () => ctrf('FAIL') }).parseAsync(
      ['run', '--cwd', dir, '--artifacts-dir', path.join(dir, 'artifacts')],
      { from: 'user' },
    );

    expect(stdout).toContain('gate: BLOCK');
    expect(process.exitCode).toBe(1);
  });

  it('exits 0 when `run` passes', async () => {
    await buildProgram({ runTests: async () => ctrf('PASS') }).parseAsync(
      ['run', '--cwd', dir, '--artifacts-dir', path.join(dir, 'artifacts')],
      { from: 'user' },
    );

    expect(stdout).toContain('gate: PASS');
    expect(process.exitCode).toBeUndefined();
  });
});
