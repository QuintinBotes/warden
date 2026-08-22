import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aggregate, analyze, runAgent, runTier } from './warden-cli.js';
import type { ExecFn } from './types.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { defaultExec } from './defaults.js';

const execFileAsync = promisify(execFile);

/**
 * The built `warden` CLI. The action composes the CLI as a subprocess rather than importing it,
 * so the only way to know its argv is accepted is to hand that argv to the real binary — a fake
 * `exec` returns canned output no matter what flags it is given, which is how an argv the CLI
 * rejects outright once shipped for a whole release.
 */
const CLI_BIN = fileURLToPath(new URL('../../cli/dist/bin/warden.js', import.meta.url));

/** The subcommand argv, with npx's own launcher flags (`--yes --package=… --`) stripped. */
function subcommandArgv(args: string[]): string[] {
  const bin = args.indexOf('warden');
  expect(bin, `no \`warden\` in ${args.join(' ')}`).toBeGreaterThan(-1);
  expect(args.slice(0, bin).join(' ')).toContain('@warden/cli');
  return args.slice(bin + 1);
}

/** Runs the action's `runAgent` against a capturing exec and returns the argv it would send. */
async function agentArgv(
  overrides: Partial<Parameters<typeof runAgent>[1]> = {},
): Promise<string[]> {
  let sent: string[] = [];
  const capture: ExecFn = (_command, args) => {
    sent = args;
    return Promise.resolve({ stdout: '', stderr: '' });
  };
  await runAgent(capture, {
    strategy: 'exploratory',
    url: 'http://localhost:3000',
    prNumber: 1,
    provider: 'anthropic',
    output: 'warden-reports/exploratory.json',
    ...overrides,
  });
  return sent;
}

describe('runAgent argv', () => {
  it('sends the provider and model the action was configured with', async () => {
    const argv = subcommandArgv(await agentArgv({ provider: 'openai', model: 'gpt-5' }));
    expect(argv[0]).toBe('agent');
    expect(argv).toContain('--provider');
    expect(argv[argv.indexOf('--provider') + 1]).toBe('openai');
    expect(argv[argv.indexOf('--model') + 1]).toBe('gpt-5');
  });

  it('is accepted by the real CLI — every flag it sends is one the agent command declares', async () => {
    expect(
      existsSync(CLI_BIN),
      `${CLI_BIN} is missing — run \`pnpm -w build\` before the test suite`,
    ).toBe(true);

    // A provider name no build will ever accept: the CLI must get far enough to reject the
    // *value*, which it can only do once every flag before it has parsed.
    const argv = await agentArgv({ provider: 'definitely-not-a-provider' });

    // A config-less directory, exactly like a checkout the action runs `npx warden` in.
    const cwd = await mkdtemp(join(tmpdir(), 'warden-action-cli-'));
    try {
      const result = await execFileAsync(process.execPath, [CLI_BIN, ...subcommandArgv(argv)], {
        cwd,
      }).then(
        (ok) => ({ code: 0, stderr: ok.stderr }),
        (err: { code?: number; stderr?: string }) => ({
          code: err.code ?? 1,
          stderr: err.stderr ?? '',
        }),
      );

      expect(result.stderr).not.toMatch(/unknown option/);
      expect(result.stderr).toContain('definitely-not-a-provider');
      expect(result.code).not.toBe(0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});

/**
 * `warden` exits 1 when its gate BLOCKs (docs/cli.md, "Exit codes"). The action shells out to
 * it, so it has to tell that apart from a CLI that crashed — otherwise every blocked PR is
 * reported as a broken step and the real reason is lost.
 *
 * These run a real subprocess through the action's own `defaultExec`, so the rejection the
 * code recovers from is the one Node actually produces for a non-zero exit, not a hand-shaped
 * imitation of it.
 */
const BLOCK_REPORT = {
  gate: { decision: 'BLOCK', reason: '1 test(s) failed' },
  reportPath: 'warden-reports/warden-ctrf.json',
  summary: { total: 2, passed: 1, failed: 1 },
};

/** A stand-in `warden` binary: same streams and same exit codes, none of the work. */
const FAKE_CLI = `
const mode = process.env.FAKE_WARDEN_MODE;
if (mode === 'crash') {
  process.stderr.write('warden: ENOENT: playwright is not installed\\n');
  process.exit(1);
}
if (process.argv.includes('aggregate')) {
  process.stdout.write(JSON.stringify(${JSON.stringify(BLOCK_REPORT)}) + '\\n');
  process.stderr.write('gate: BLOCK — 1 test(s) failed\\n');
} else {
  process.stdout.write('wrote CTRF report to warden-artifacts/ctrf-report.json\\n');
  process.stdout.write('gate: BLOCK — 1 test(s) failed\\n');
}
process.exit(1);
`;

describe('the action reads an exit-1 gate instead of calling it a crash', () => {
  let dir: string;
  let exec: ExecFn;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'warden-action-cli-'));
    const script = path.join(dir, 'fake-warden.cjs');
    await fs.writeFile(script, FAKE_CLI, 'utf-8');
    // The launcher is substituted, the argv the action built is not — the wrappers under test
    // still assemble and pass their own flags.
    exec = (_command, args, options) => defaultExec(process.execPath, [script, ...args], options);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('finishes a tier whose tests failed rather than reporting the tier as failed', async () => {
    await expect(
      runTier(exec, { grep: '@smoke', output: 'smoke.ctrf.json', env: { ...process.env } }),
    ).resolves.toBeUndefined();
  });

  it('returns the gate report a blocked aggregate printed while exiting 1', async () => {
    const report = await aggregate(exec, {
      reportsDir: 'warden-reports',
      prNumber: 482,
      env: { ...process.env },
    });

    expect(report.gate.decision).toBe('BLOCK');
    expect(report.gate.reason).toBe('1 test(s) failed');
    expect(report.summary?.failed).toBe(1);
  });

  it('still throws when the CLI crashed, so the action fails closed on an unevaluated gate', async () => {
    const crashed: ExecFn = (command, args, options) =>
      exec(command, args, { ...options, env: { ...process.env, FAKE_WARDEN_MODE: 'crash' } });

    await expect(
      aggregate(crashed, { reportsDir: 'warden-reports', prNumber: 482 }),
    ).rejects.toThrow();
    await expect(runTier(crashed, { grep: '@smoke', output: 'smoke.ctrf.json' })).rejects.toThrow();
  });
});

/**
 * `npx warden …` does not run this project's CLI.
 *
 * The unscoped name `warden` on npm belongs to an unrelated package published in 2014
 * ("A wrapper for Panopticon", latest 0.1.1) which declares no `bin`. Handed that name,
 * npx downloads a stranger's tarball and then exits with "could not determine executable
 * to run" — a third-party download where the user asked for Warden, and a failure message
 * that names nothing the user can act on.
 *
 * So every call the action shells out has to name the package the binary actually comes
 * from. These tests assert the argv, because the argv is where the resolution happens.
 */
const CLI_PACKAGE = '@warden/cli';

interface Call {
  command: string;
  args: string[];
}

/** Records every exec call; returns output both parsers accept. */
function recordingExec(): { calls: Call[]; exec: ExecFn } {
  const calls: Call[] = [];
  const exec: ExecFn = (command, args) => {
    calls.push({ command, args });
    return Promise.resolve({
      stdout: 'risk_score=3\n{"gate":{"decision":"PASS","reason":"ok"}}',
      stderr: '',
    });
  };
  return { calls, exec };
}

/** Every CLI call the action can make, exercised once. */
async function everyCall(): Promise<Call[]> {
  const { calls, exec } = recordingExec();
  await analyze(exec, { baseSha: 'base', headSha: 'head' });
  await runTier(exec, { grep: '@smoke', output: 'ctrf.json' });
  await runAgent(exec, {
    strategy: 'exploratory',
    url: 'http://localhost:3000',
    prNumber: 7,
    provider: 'anthropic',
    output: 'agent.json',
  });
  await aggregate(exec, { reportsDir: 'warden-artifacts', prNumber: 7 });
  return calls;
}

describe('how the action names the CLI it shells out to', () => {
  it('never hands npx the unscoped package name `warden`', async () => {
    for (const call of await everyCall()) {
      // npx resolves its first positional as a package spec: `warden` there is the
      // stranger's package, not this one.
      expect(call.args[0], `\`${call.command} ${call.args.join(' ')}\``).not.toBe('warden');
      expect(call.args.join(' ')).not.toMatch(/(^|\s)npx\s+warden(\s|$)/);
    }
  });

  it('names @warden/cli, the package that contains the binary', async () => {
    for (const call of await everyCall()) {
      expect(
        call.args.some((arg) => arg === CLI_PACKAGE || arg === `--package=${CLI_PACKAGE}`),
        `\`${call.command} ${call.args.join(' ')}\` does not name ${CLI_PACKAGE}`,
      ).toBe(true);
    }
  });

  it("ends npx's own flags with `--`, so a CLI flag cannot be eaten by the launcher", async () => {
    for (const call of await everyCall()) {
      const separator = call.args.indexOf('--');
      expect(separator, `\`${call.args.join(' ')}\` has no -- separator`).toBeGreaterThan(-1);
      expect(call.args[separator + 1]).toBe('warden');
    }
  });

  it('still passes the subcommand and its flags through unchanged', async () => {
    const [analyzeCall, runCall, agentCall, aggregateCall] = await everyCall();

    expect(analyzeCall!.args.slice(-5)).toEqual(['analyze', '--base', 'base', '--head', 'head']);
    expect(runCall!.args.slice(-4)).toEqual(['--grep', '@smoke', '--output', 'ctrf.json']);
    expect(agentCall!.args).toContain('--strategy');
    // `--json` is part of that argv: it is the only form the action can parse.
    expect(aggregateCall!.args.slice(-7)).toEqual([
      'report',
      'aggregate',
      '--reports',
      'warden-artifacts',
      '--pr',
      '7',
      '--json',
    ]);
  });
});
