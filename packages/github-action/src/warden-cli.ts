/**
 * Thin wrappers around the four `warden` CLI subcommands the action shells out
 * to. The runner (`exec`) is injected, so unit tests supply a fake that returns
 * canned output instead of spawning a real subprocess.
 *
 * The CLI (`@warden/cli`, WS-20) is a sibling work-stream; the action never
 * imports it — it composes it as a subprocess, exactly as CI would.
 */
import { parseAggregateReport, parseGithubOutput } from './parse.js';
import type { AggregateReport } from './parse.js';
import type { ExecFn, ExecOptions } from './types.js';

/** The launcher used for every CLI call (`npx warden …`). */
export const CLI_LAUNCHER = 'npx';

function args(sub: string[]): string[] {
  return ['warden', ...sub];
}

/** `warden analyze` → change-surface key/values (tags, risk, run_full_suite). */
export async function analyze(
  exec: ExecFn,
  opts: { baseSha: string; headSha: string } & ExecOptions,
): Promise<Record<string, string>> {
  const { baseSha, headSha, ...execOpts } = opts;
  const res = await exec(
    CLI_LAUNCHER,
    args(['analyze', '--base', baseSha, '--head', headSha]),
    execOpts,
  );
  return parseGithubOutput(res.stdout);
}

/** `warden run --grep <tags> --output <file>` → runs a test tier, writes CTRF. */
export async function runTier(
  exec: ExecFn,
  opts: { grep: string; output: string } & ExecOptions,
): Promise<void> {
  const { grep, output, ...execOpts } = opts;
  await exec(CLI_LAUNCHER, args(['run', '--grep', grep, '--output', output]), execOpts);
}

/** `warden agent --strategy <s> --url <u> …` → runs an AI strategy, writes a report. */
export async function runAgent(
  exec: ExecFn,
  opts: {
    strategy: string;
    url: string;
    prNumber: number;
    provider: string;
    model?: string;
    output: string;
  } & ExecOptions,
): Promise<void> {
  const { strategy, url, prNumber, provider, model, output, ...execOpts } = opts;
  const cliArgs = [
    'agent',
    '--strategy',
    strategy,
    '--url',
    url,
    '--pr-number',
    String(prNumber),
    '--provider',
    provider,
    '--output',
    output,
  ];
  if (model) cliArgs.push('--model', model);
  await exec(CLI_LAUNCHER, args(cliArgs), execOpts);
}

/** `warden report aggregate --reports <dir> --pr <n>` → merged gate report JSON. */
export async function aggregate(
  exec: ExecFn,
  opts: { reportsDir: string; prNumber: number } & ExecOptions,
): Promise<AggregateReport> {
  const { reportsDir, prNumber, ...execOpts } = opts;
  const res = await exec(
    CLI_LAUNCHER,
    args(['report', 'aggregate', '--reports', reportsDir, '--pr', String(prNumber)]),
    execOpts,
  );
  return parseAggregateReport(res.stdout);
}
