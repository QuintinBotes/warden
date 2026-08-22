/**
 * The contract between the action and the CLI, checked against the real thing.
 *
 * `warden-cli.ts` shells the `warden` binary and hands its stdout to
 * `parseAggregateReport`. Nothing in the action's own unit tests spawns that
 * binary — `fakeExec` in `run.test.ts` returns whatever shape the test wants —
 * so the two halves drifted apart unnoticed: the CLI printed a human sentence
 * and the parser required JSON, which made every PR fail closed to BLOCK.
 *
 * These tests run the built CLI as a subprocess and feed its actual stdout to
 * the action's actual parser, so the two can never disagree again silently.
 * They need `pnpm -w build` first, which is the documented order in
 * CONTRIBUTING.md and the order CI uses.
 *
 * A second suite below approaches the same contract from the other end: it hands the argv the
 * Action emits to the CLI's own Commander parser, so an unknown or missing option fails here
 * without spawning anything. Between them, neither the flags nor the stdout format can drift.
 */
import type { Command } from 'commander';
import { buildProgram, toGateReport, type RunReportResult } from '@warden/cli';
import { run } from './run.js';
import type { ActionsCoreLike, ActionsSummaryLike, FsLike, OctokitLike } from './types.js';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAggregateReport } from './parse.js';
import { aggregate } from './warden-cli.js';
import type { ExecFn } from './types.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const cliBin = path.join(repoRoot, 'packages/cli/dist/bin/warden.js');

/** A CTRF report with one test in the given state. */
function ctrf(test: Record<string, unknown>, passed: number, failed: number): string {
  return JSON.stringify({
    results: {
      tool: { name: 'playwright' },
      summary: { tests: 1, passed, failed, skipped: 0, pending: 0, other: 0, start: 1, stop: 2 },
      tests: [test],
    },
  });
}

interface CliResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Run the real CLI in `cwd`; resolves whatever the process printed, exit code included. */
function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cliBin, ...args],
      { cwd, env: { ...process.env, ...env } },
      (err, stdout, stderr) => {
        const code = (err as { code?: number } | null)?.code ?? 0;
        resolve({
          stdout: String(stdout),
          stderr: String(stderr),
          code: typeof code === 'number' ? code : 1,
        });
      },
    );
  });
}

describe('the action can read the gate the CLI computed', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // A real HTTP server, not a mock: `report aggregate` posts the gate comment through the
    // configured VCS host before it prints anything, so the CLI must get a real 201 back.
    server = createServer((_req, res) => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end('{"id":1}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api/v4`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function workspace(reportJson: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'warden-cli-contract-'));
    mkdirSync(path.join(dir, 'reports'));
    writeFileSync(path.join(dir, 'reports', 'a.json'), reportJson);
    writeFileSync(
      path.join(dir, 'warden.config.ts'),
      `export default { vcs: { provider: 'gitlab', baseUrl: '${baseUrl}' } };\n`,
    );
    return dir;
  }

  const env = { GITLAB_TOKEN: 'x', CI_PROJECT_PATH: 'o/r' };

  it('has a built CLI to run against', () => {
    expect(existsSync(cliBin), `${cliBin} is missing — run \`pnpm -w build\` first`).toBe(true);
  });

  it('a passing run reaches the action as PASS, not as an unreadable blob', async () => {
    const dir = workspace(ctrf({ name: 't1', status: 'passed', duration: 5 }, 1, 0));
    const res = await runCli(
      ['report', 'aggregate', '--reports', 'reports', '--pr', '1', '--json'],
      dir,
      env,
    );

    const report = parseAggregateReport(res.stdout);
    expect(report.gate.decision).toBe('PASS');
    expect(report.gate.reason).toBe('All tests passed');
    expect(report.summary).toEqual({ total: 1, passed: 1, failed: 0 });
  });

  it('a failing run reaches the action as BLOCK with the failure it can annotate', async () => {
    const dir = workspace(
      ctrf(
        {
          name: 'checkout applies a discount',
          status: 'failed',
          duration: 7,
          filePath: 'tests/checkout.spec.ts',
          message: 'expected 10, got 0',
        },
        0,
        1,
      ),
    );
    const res = await runCli(
      ['report', 'aggregate', '--reports', 'reports', '--pr', '1', '--json'],
      dir,
      env,
    );

    const report = parseAggregateReport(res.stdout);
    expect(report.gate.decision).toBe('BLOCK');
    expect(report.summary).toEqual({ total: 1, passed: 0, failed: 1 });
    expect(report.failures?.[0]).toMatchObject({
      path: 'tests/checkout.spec.ts',
      message: 'expected 10, got 0',
      title: 'checkout applies a discount',
    });
  });

  it('keeps the human line for a person, on stderr, out of the machine-readable stdout', async () => {
    const dir = workspace(ctrf({ name: 't1', status: 'passed', duration: 5 }, 1, 0));
    const res = await runCli(
      ['report', 'aggregate', '--reports', 'reports', '--pr', '1', '--json'],
      dir,
      env,
    );

    expect(res.stdout.trimStart().startsWith('{')).toBe(true);
    expect(res.stderr).toContain('gate: PASS');
  });

  it('still prints the human line on stdout when --json is not asked for', async () => {
    const dir = workspace(ctrf({ name: 't1', status: 'passed', duration: 5 }, 1, 0));
    const res = await runCli(
      ['report', 'aggregate', '--reports', 'reports', '--pr', '1'],
      dir,
      env,
    );

    expect(res.stdout).toBe('gate: PASS — All tests passed\n');
  });
});

describe('the action asks the CLI for the machine-readable report', () => {
  it('sends --json, which is the only argv that produces one', async () => {
    let sent: string[] = [];
    const exec: ExecFn = (_command, args) => {
      sent = args;
      return Promise.resolve({
        stdout: JSON.stringify({ gate: { decision: 'PASS', reason: 'All tests passed' } }),
        stderr: '',
      });
    };

    await aggregate(exec, { reportsDir: 'warden-reports', prNumber: 12 });

    expect(subcommandArgv(sent)).toEqual([
      'report',
      'aggregate',
      '--reports',
      'warden-reports',
      '--pr',
      '12',
      '--json',
    ]);
  });
});

const PR_EVENT = {
  pull_request: {
    number: 123,
    title: 'Payment retry',
    html_url: 'https://github.com/acme/shop/pull/123',
    head: { sha: 'head-sha-123' },
    base: { sha: 'base-sha-000' },
    user: { login: 'octocat' },
  },
  repository: { name: 'shop', owner: { login: 'acme' } },
};

/** Every command in the tree, including nested ones (`report aggregate`, `visual approve`). */
function allCommands(cmd: Command): Command[] {
  return cmd.commands.flatMap((c) => [c, ...allCommands(c)]);
}

/** What one accepted invocation looked like: the subcommand path and its parsed options. */
interface ParsedCall {
  path: string;
  opts: Record<string, unknown>;
}

/** The subcommand argv, with npx's own launcher flags (`--yes --package=… --`) stripped. */
function subcommandArgv(args: string[]): string[] {
  const bin = args.indexOf('warden');
  expect(bin, `no \`warden\` in ${args.join(' ')}`).toBeGreaterThan(-1);
  expect(args.slice(0, bin).join(' ')).toContain('@warden/cli');
  return args.slice(bin + 1);
}

/**
 * Parse `argv` with the real CLI program, with every action handler replaced by a recorder so
 * nothing actually runs. Throws whatever Commander would print and exit on — an unknown option,
 * a missing required one — which is what a subprocess would return as a non-zero exit.
 */
function parseWithRealCli(argv: string[]): ParsedCall {
  const program = buildProgram({ version: '0.0.0-test' });
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });

  let seen: ParsedCall | null = null;
  for (const cmd of allCommands(program)) {
    cmd.exitOverride();
    cmd.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    const path =
      cmd.parent && cmd.parent.parent ? `${cmd.parent.name()} ${cmd.name()}` : cmd.name();
    cmd.action(() => {
      seen = { path, opts: cmd.opts() };
    });
  }

  program.parse(argv, { from: 'user' });
  if (seen === null) throw new Error(`no command ran for: ${argv.join(' ')}`);
  return seen;
}

function fakeCore(): ActionsCoreLike & { warnings: string[]; errors: string[] } {
  const summary: ActionsSummaryLike = {
    addRaw() {
      return summary;
    },
    write() {
      return Promise.resolve();
    },
  };
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    warnings,
    errors,
    getInput: (name: string) =>
      ({
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        strategy: 'exploratory',
        'risk-threshold': '4',
        'anthropic-api-key': 'sk-test',
      })[name] ?? '',
    setOutput() {},
    info() {},
    warning: (m: string) => warnings.push(m),
    error: (m: string) => errors.push(m),
    setFailed() {},
    summary,
  };
}

const fs: FsLike = { readFileSync: () => JSON.stringify(PR_EVENT) };
const octokit: OctokitLike = {
  issues: { createComment: () => Promise.resolve({}) },
  checks: { create: () => Promise.resolve({}) },
};

/** A `RunReportResult` shaped like a real one, used to produce real `--json` stdout. */
const REPORT_RESULT = {
  report: {
    results: {
      tool: { name: 'warden' },
      summary: {
        tests: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        pending: 0,
        other: 0,
        start: 0,
        stop: 1,
      },
      tests: [
        {
          name: 'checkout › pays with Visa',
          status: 'failed',
          duration: 12,
          filePath: 'apps/checkout/pay.spec.ts',
          message: 'expected 200, got 500',
        },
      ],
    },
  },
  execution: {
    id: 'exec-1',
    testPlanId: 'plan-1',
    triggerType: 'pr',
    triggerRef: '123',
    environment: 'ci',
    startedAt: new Date(0),
    results: [
      {
        testCaseId: 'abc',
        name: 'checkout › pays with Visa',
        filePath: 'apps/checkout/pay.spec.ts',
        status: 'FAIL',
        duration: 12,
        errorMessage: 'expected 200, got 500',
        artifacts: [],
        retries: 0,
        flakeFlag: false,
      },
    ],
  },
  gate: { decision: 'BLOCK', reason: '1 failed test(s)' },
} as unknown as RunReportResult;

/** An `exec` that validates argv against the real CLI and answers as the real CLI answers. */
function contractExec(calls: ParsedCall[]): ExecFn {
  return (command, argv) => {
    expect(command).toBe('npx');
    const call = parseWithRealCli(subcommandArgv(argv));
    calls.push(call);

    if (call.path === 'analyze') {
      return Promise.resolve({
        stdout: 'test_tags=@apps/checkout\nrisk_score=7\nrun_full_suite=false\n',
        stderr: '',
      });
    }
    if (call.path === 'report aggregate') {
      // Exactly what the CLI writes for `--json`, produced by the CLI's own projection.
      return Promise.resolve({
        stdout: call.opts.json
          ? `${JSON.stringify(toGateReport(REPORT_RESULT), null, 2)}\n`
          : 'gate: BLOCK — 1 failed test(s)\n',
        stderr: '',
      });
    }
    return Promise.resolve({ stdout: '', stderr: '' });
  };
}

describe('the argv the Action emits against the CLI in this repo', () => {
  it('is accepted by every warden subcommand it invokes, and the gate reads the answer', async () => {
    const calls: ParsedCall[] = [];
    const core = fakeCore();

    const result = await run({
      core,
      octokit,
      exec: contractExec(calls),
      env: { GITHUB_REPOSITORY: 'acme/shop' },
      eventPath: '/event.json',
      fs,
    });

    // No tier was downgraded to a warning: every invocation parsed.
    expect(core.warnings).toEqual([]);

    const paths = calls.map((c) => c.path);
    expect(paths).toEqual(['analyze', 'run', 'run', 'agent', 'report aggregate']);

    // Each tier's CTRF lands in its own file under one aggregate-able directory.
    const tiers = calls.filter((c) => c.path === 'run');
    expect(tiers.map((c) => c.opts.output)).toEqual([
      'warden-reports/smoke.ctrf.json',
      'warden-reports/regression.ctrf.json',
    ]);

    // The agent report is NOT in that directory: `report aggregate` parses every `*.json`
    // there as a CTRF report, and an AgentOutput is not one.
    const agent = calls.find((c) => c.path === 'agent');
    expect(String(agent?.opts.output).startsWith('warden-reports/')).toBe(false);
    expect(agent?.opts.provider).toBe('anthropic');
    expect(agent?.opts.model).toBe('claude-sonnet-5');

    // The gate came from the aggregate report, not from the fail-closed crash path.
    expect(result.gate).toBe('BLOCK');
    expect(core.errors).toEqual([]);
  });

  it('parses the JSON `warden report aggregate --json` actually prints', () => {
    const stdout = `${JSON.stringify(toGateReport(REPORT_RESULT), null, 2)}\n`;
    const parsed = parseAggregateReport(stdout);

    expect(parsed.gate).toEqual({ decision: 'BLOCK', reason: '1 failed test(s)' });
    expect(parsed.summary).toEqual({ total: 2, passed: 1, failed: 1 });
    expect(parsed.failures?.[0]).toMatchObject({
      path: 'apps/checkout/pay.spec.ts',
      message: 'expected 200, got 500',
      title: 'checkout › pays with Visa',
      annotation_level: 'failure',
    });
  });

  it('rejects a flag the CLI does not have, so this test can fail when the contract breaks', () => {
    expect(() => parseWithRealCli(['run', '--grep', '@smoke', '--nope', 'x'])).toThrow(
      /unknown option/,
    );
  });
});
