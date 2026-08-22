/**
 * The contract between this Action and the `warden` CLI it shells out to.
 *
 * Every other test in this package injects a fake `ExecFn` that accepts any argv, so an argv
 * naming a flag the CLI does not define passes them all and fails only in a real job — where
 * `run.ts` downgrades it to `core.warning(...)` and the tier silently produces nothing. That is
 * exactly the defect this file exists to catch: it feeds the argv the wrappers build to the
 * CLI's own Commander tree (`buildProgram`, imported from `@warden/cli`), so the flags the
 * Action sends and the flags the CLI declares are read from one place, not two.
 *
 * Parsing is the assertion. Every command's action handler is replaced with a no-op first, so
 * `parseAsync` validates option names and mandatory options without running a browser, a test
 * suite, or a network call.
 */
import { describe, expect, it } from 'vitest';
import type { Command } from 'commander';
import { buildProgram } from '@warden/cli';
import { CLI_LAUNCHER } from './warden-cli.js';
import { analyze, aggregate, runAgent, runTier } from './warden-cli.js';
import type { ExecFn, ExecResult } from './types.js';

/** Every command in the tree, including nested ones (`report aggregate`, `visual approve`). */
function allCommands(cmd: Command): Command[] {
  return [cmd, ...cmd.commands.flatMap((c) => allCommands(c as Command))];
}

/**
 * Parses `args` with the real CLI program. Throws a `CommanderError` when the CLI would have
 * exited non-zero — which is what an unknown option or a missing required option does.
 */
async function parseWithRealCli(args: string[]): Promise<void> {
  const program = buildProgram({ version: '0.0.0-contract-test' });
  for (const cmd of allCommands(program)) {
    cmd.exitOverride();
    cmd.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    // Replace the real handler: this test is about the flag surface, not about running a tier.
    cmd.action(() => {});
  }
  await program.parseAsync(args, { from: 'user' });
}

/** The subcommand argv, with npx's own launcher flags (`--yes --package=… --`) stripped. */
function subcommandArgv(args: string[]): string[] {
  const bin = args.indexOf('warden');
  expect(bin, `no \`warden\` in ${args.join(' ')}`).toBeGreaterThan(-1);
  expect(args.slice(0, bin).join(' ')).toContain('@warden/cli');
  return args.slice(bin + 1);
}

/** Runs `build`, captures the single argv it hands the exec fn, and drops the `warden` prefix. */
async function capture(build: (exec: ExecFn) => Promise<unknown>): Promise<string[]> {
  const calls: { command: string; args: string[] }[] = [];
  const exec: ExecFn = (command, args) => {
    calls.push({ command, args });
    // `aggregate` parses this; the others ignore it.
    return Promise.resolve({ stdout: '{"gate":{"decision":"PASS","reason":"ok"}}', stderr: '' });
  };
  await build(exec);
  expect(calls).toHaveLength(1);
  const call = calls[0]!;
  expect(call.command).toBe(CLI_LAUNCHER);
  return subcommandArgv(call.args);
}

describe('the argv the Action sends is argv the warden CLI accepts', () => {
  it('rejects a flag the CLI does not define, so this check cannot pass vacuously', async () => {
    await expect(parseWithRealCli(['run', '--no-such-flag'])).rejects.toThrow(/unknown option/);
  });

  it('accepts the argv `warden analyze` is invoked with', async () => {
    const args = await capture((exec) =>
      analyze(exec, { baseSha: 'base-sha-000', headSha: 'head-sha-123' }),
    );
    await expect(parseWithRealCli(args)).resolves.toBeUndefined();
  });

  it('accepts the argv the smoke tier is invoked with', async () => {
    const args = await capture((exec) =>
      runTier(exec, {
        grep: '@smoke',
        artifactsDir: 'warden-reports/smoke',
        output: 'warden-reports/smoke.ctrf.json',
      }),
    );
    await expect(parseWithRealCli(args)).resolves.toBeUndefined();
  });

  it('accepts the argv the regression tier is invoked with, diff bounds and preview URL included', async () => {
    const args = await capture((exec) =>
      runTier(exec, {
        grep: '@apps/checkout',
        artifactsDir: 'warden-reports/regression',
        output: 'warden-reports/regression.ctrf.json',
        baseSha: 'base-sha-000',
        headSha: 'head-sha-123',
        baseUrl: 'https://preview.example.com',
      }),
    );
    await expect(parseWithRealCli(args)).resolves.toBeUndefined();
  });

  it('accepts the argv the AI agent tier is invoked with, including the provider and model inputs', async () => {
    const args = await capture((exec) =>
      runAgent(exec, {
        strategy: 'exploratory',
        url: 'http://localhost:3000',
        prNumber: 123,
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        output: 'warden-reports/exploratory.json',
      }),
    );
    await expect(parseWithRealCli(args)).resolves.toBeUndefined();
  });

  it('accepts the argv the agent tier is invoked with when no model input is set', async () => {
    const args = await capture((exec) =>
      runAgent(exec, {
        strategy: 'exploratory',
        url: 'http://localhost:3000',
        prNumber: 123,
        provider: 'anthropic',
        output: 'warden-reports/exploratory.json',
      }),
    );
    await expect(parseWithRealCli(args)).resolves.toBeUndefined();
  });

  it('accepts the argv `warden report aggregate` is invoked with', async () => {
    const args = await capture(async (exec): Promise<ExecResult | unknown> =>
      aggregate(exec, { reportsDir: 'warden-reports', prNumber: 123 }),
    );
    await expect(parseWithRealCli(args)).resolves.toBeUndefined();
  });
});
