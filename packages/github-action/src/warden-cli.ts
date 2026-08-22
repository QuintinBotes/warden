/**
 * Thin wrappers around the four `warden` CLI subcommands the action shells out
 * to. The runner (`exec`) is injected, so unit tests supply a fake that returns
 * canned output instead of spawning a real subprocess.
 *
 * The CLI (`@warden/cli`, WS-20) is a sibling work-stream; the action never
 * imports it — it composes it as a subprocess, exactly as CI would. Only the
 * *name* is shared, from `@warden/core`: the package spec has to be the scoped
 * one, because the unscoped `warden` on npm is a stranger's package and npx would
 * happily download and run it instead.
 */
import { CLI_LAUNCHER, cliLauncherArgs } from '@warden/core';
import { parseAggregateReport, parseGithubOutput } from './parse.js';
import type { AggregateReport } from './parse.js';
import type { ExecFn, ExecOptions, ExecResult } from './types.js';

/** The launcher used for every CLI call (`npx --yes --package=@warden/cli -- warden …`). */
export { CLI_LAUNCHER };

/**
 * The line every gate-bearing `warden` command ends on. `--json` moves it to stderr, so both
 * streams are searched.
 */
const GATE_LINE = /^gate: (PASS|WARN|BLOCK)\b/m;

/** The output an `execFile` rejection carries when the command ran and exited non-zero. */
interface ExecFailure {
  code?: unknown;
  stdout?: unknown;
  stderr?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value instanceof Buffer ? value.toString() : '';
}

/**
 * Runs a `warden` command whose exit code carries a gate decision.
 *
 * `warden` exits 1 when the gate BLOCKs (docs/cli.md, "Exit codes") and still writes
 * everything it was asked to write, so a non-zero exit is a *result* here, not a failure —
 * treating it as one would report every blocked PR as a crashed step. The two are told apart
 * by evidence rather than by the code: a command that reached its gate printed the decision,
 * and a crash printed none. A rejection with no gate line in it is rethrown, which is what
 * keeps the action failing closed on a gate it could not evaluate.
 */
async function execGate(
  exec: ExecFn,
  command: string,
  argv: string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  try {
    return await exec(command, argv, options);
  } catch (err) {
    const failure = err as ExecFailure;
    if (typeof failure.code !== 'number') throw err;
    const result: ExecResult = { stdout: text(failure.stdout), stderr: text(failure.stderr) };
    if (!GATE_LINE.test(result.stdout) && !GATE_LINE.test(result.stderr)) throw err;
    return result;
  }
}

/** `warden analyze` → change-surface key/values (tags, risk, run_full_suite). */
export async function analyze(
  exec: ExecFn,
  opts: { baseSha: string; headSha: string } & ExecOptions,
): Promise<Record<string, string>> {
  const { baseSha, headSha, ...execOpts } = opts;
  const res = await exec(
    CLI_LAUNCHER,
    cliLauncherArgs(['analyze', '--base', baseSha, '--head', headSha]),
    execOpts,
  );
  return parseGithubOutput(res.stdout);
}

/**
 * `warden run --grep <tags> --artifacts-dir <dir> --output <file>` → runs a test tier, writes CTRF.
 *
 * `artifactsDir` and `output` are separate on purpose: every tier's CTRF has to land in the one
 * directory `report aggregate --reports` reads (and under a distinct name, or the tiers overwrite
 * each other), while the bulky per-tier artifacts — screenshots, videos, traces — stay in a
 * subdirectory that the aggregation pass does not read.
 */
export async function runTier(
  exec: ExecFn,
  opts: {
    grep: string;
    /** Where this tier's CTRF report lands. Every tier writes into the one directory the
     *  aggregate step later merges, so each needs its own file name. */
    output: string;
    /** Screenshots, videos and the tier's own reporter output. Per tier, so two tiers running
     *  in one workspace do not overwrite each other's artifacts. */
    artifactsDir?: string;
    /** Diff bounds — passed through so `warden run` can run the route-scoped a11y/perf tiers
     *  and the CUJ-scoped gate against the change surface. */
    baseSha?: string;
    headSha?: string;
    /** Preview/staging deployment URL for the a11y/perf tiers. */
    baseUrl?: string;
  } & ExecOptions,
): Promise<void> {
  const { grep, output, artifactsDir, baseSha, headSha, baseUrl, ...execOpts } = opts;
  const extra: string[] = [];
  if (artifactsDir) extra.push('--artifacts-dir', artifactsDir);
  if (baseSha && headSha) extra.push('--base', baseSha, '--head', headSha);
  if (baseUrl) extra.push('--base-url', baseUrl);
  // A tier whose tests failed exits 1. The CTRF it wrote is what the aggregate step gates on,
  // so that is a finished tier, not a failed one — `execGate` keeps it from being reported as
  // a crash while still rethrowing a tier that really did crash.
  await execGate(
    exec,
    CLI_LAUNCHER,
    cliLauncherArgs(['run', '--grep', grep, '--output', output, ...extra]),
    execOpts,
  );
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
  await exec(CLI_LAUNCHER, cliLauncherArgs(cliArgs), execOpts);
}

/**
 * `warden report aggregate --reports <dir> --pr <n> --json` → the merged `GateReport`.
 *
 * `--json` is not optional here: without it the CLI's stdout is a human sentence, which this
 * parser cannot read, which the caller's fail-closed rule turns into a BLOCK on every PR.
 * That was shipped once — the action asked for text and parsed JSON — so the flag and the
 * parser are written on the same line of code deliberately. This step also needs the counts
 * and the failing tests the report carries, to build the check run.
 */
export async function aggregate(
  exec: ExecFn,
  opts: { reportsDir: string; prNumber: number } & ExecOptions,
): Promise<AggregateReport> {
  const { reportsDir, prNumber, ...execOpts } = opts;
  // A BLOCK exits 1 with the gate report still on stdout — the decision the action exists to
  // read. Rejecting on the exit code would lose it and re-report the block as "gate not
  // evaluated", which is a different (and untrue) thing to tell a reviewer.
  const res = await execGate(
    exec,
    CLI_LAUNCHER,
    cliLauncherArgs([
      'report',
      'aggregate',
      '--reports',
      reportsDir,
      '--pr',
      String(prNumber),
      '--json',
    ]),
    execOpts,
  );
  return parseAggregateReport(res.stdout);
}
