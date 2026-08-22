/**
 * The `warden` Commander program, built as a value rather than as a side effect of loading
 * `bin/warden.ts`. `bin/warden.ts` is the only production caller; it hands in nothing but the
 * version and parses `process.argv`.
 *
 * It lives here so the wiring is reachable from a test. The gate's exit code is part of that
 * wiring — no command function returns it, they only return a `GateDecision` — so with the
 * program locked inside an executable that parses `process.argv` on import, nothing could
 * assert that a BLOCK fails the CI step. That is exactly the hole a BLOCK exiting 0 fell
 * through.
 *
 * The same hole shipped a second class of defect: the GitHub Action composes this CLI as a
 * subprocess, and the only thing connecting the two was hope. `buildProgram()` lets a test
 * parse the exact argv the Action emits and fail when a flag no longer exists — which is how
 * `--output`, `--provider` and `--model` were shipped against a CLI that rejected all three.
 */
import { Command } from 'commander';
import { loadConfig as defaultLoadConfig, type StrategyName } from '@warden/core';
import { analyzeChangeSurface } from '@warden/orchestrator';
import { readFile } from 'node:fs/promises';
import { load as parseYaml } from 'js-yaml';
import { loadCoverageIndex, selectWithImpact } from '@warden/impact';
import { SqliteStore } from '@warden/test-management';
import { createOverwriteConfirm } from './confirm-overwrite.js';
import { fsCujSource } from './cuj-gate.js';
import { applyGateExitCode, type ProcessLike } from './gate-exit.js';
import {
  createFetchOctokit,
  createVcsProviderFromEnv,
  resolveVcsHeadSha,
  resolveVcsRepoRef,
  runAgent as defaultRunAgent,
  runAnalyze as defaultRunAnalyze,
  runInit as defaultRunInit,
  runPlan,
  runReport as defaultRunReport,
  runRun as defaultRunRun,
  runVisualApprove as defaultRunVisualApprove,
  toGateReport,
  type RunReportResult,
} from './index.js';

/**
 * Collaborators {@link buildProgram} can be given instead of the real ones. Production passes
 * only `version`; tests replace the command functions, the environment and the process so a
 * command's argv-to-exit-code path runs with no test run, no network and no real `process`.
 */
export interface ProgramDeps {
  /** Reported by `warden --version`. `bin/warden.ts` reads it from the package's own manifest. */
  version?: string;
  /** Where `process.exitCode` is written. Defaults to the real `process`. */
  proc?: ProcessLike;
  /** Environment the commands read tokens and CI variables from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Streams the commands write to. Default to the real stdout/stderr. */
  stdout?: { write(chunk: string): unknown };
  stderr?: { write(chunk: string): unknown };
  loadConfig?: typeof defaultLoadConfig;
  runAnalyze?: typeof defaultRunAnalyze;
  runRun?: typeof defaultRunRun;
  runAgent?: typeof defaultRunAgent;
  runReport?: typeof defaultRunReport;
  runInit?: typeof defaultRunInit;
  runVisualApprove?: typeof defaultRunVisualApprove;
  /**
   * Stands in for the Playwright invocation inside `runRun`. Separate from `runRun` itself so a
   * test can drive the real command — config load, gate, reporters, exit code — with only the
   * test runner faked, which is the whole path the documented exit-code contract lives on.
   */
  runTests?: NonNullable<Parameters<typeof defaultRunRun>[1]>['runTests'];
}

/** Builds the `warden` program. Never parses — the caller decides when and on what argv. */
export function buildProgram(deps: ProgramDeps = {}): Command {
  const proc = deps.proc ?? process;
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const loadConfig = deps.loadConfig ?? defaultLoadConfig;
  const runAnalyze = deps.runAnalyze ?? defaultRunAnalyze;
  const runRun = deps.runRun ?? defaultRunRun;
  const runAgent = deps.runAgent ?? defaultRunAgent;
  const runReport = deps.runReport ?? defaultRunReport;
  const runInit = deps.runInit ?? defaultRunInit;
  const runVisualApprove = deps.runVisualApprove ?? defaultRunVisualApprove;

  const program = new Command();
  program
    .name('warden')
    .description('Warden — the AI QA platform CLI')
    .version(deps.version ?? '0.0.0');

  function fail(err: unknown): never {
    const message = err instanceof Error ? err.message : String(err);
    stderr.write(`warden: ${message}\n`);
    proc.exitCode = 1;
    // Marked as already reported, then rethrown. The throw is what stops the action and what
    // the tests assert on; the mark is what stops `bin/warden.ts` printing the same failure a
    // second time as a raw Node rejection. Without it a user sees the sentence this line wrote
    // and then twenty lines of stack for the same event, and in a CI log the sentence is the
    // part that scrolls away.
    if (err instanceof Error) (err as Error & { wardenReported?: true }).wardenReported = true;
    throw err;
  }

  program
    .command('analyze')
    .description('Analyze a git diff and emit a GitHub-Actions change-surface output')
    .requiredOption('--base <sha>', 'base git ref/sha to diff from')
    .requiredOption('--head <sha>', 'head git ref/sha to diff to')
    .option('--cwd <dir>', 'working directory to compute the diff in')
    .option('--output <file>', 'file to append the GitHub-Actions output lines to ($GITHUB_OUTPUT)')
    .action(async (opts: { base: string; head: string; cwd?: string; output?: string }) => {
      try {
        const content = await runAnalyze(opts, {
          // An unconfigured repository still gets a score; it must not get it silently.
          warn: (message) => stderr.write(`${message}\n`),
        });
        if (!opts.output) {
          stdout.write(content);
        }
      } catch (err) {
        fail(err);
      }
    });

  program
    .command('run')
    .description('Run tests, write the CTRF report, and invoke configured reporters')
    .option('--grep <tags>', 'Playwright --grep filter (e.g. a tier tag like @smoke)')
    .option('--cwd <dir>', 'working directory to run tests in')
    .option(
      '--artifacts-dir <dir>',
      'directory to write the CTRF report + artifacts to',
      'warden-artifacts',
    )
    .option(
      '--output <file>',
      'file the CTRF report is written to (default: <artifacts-dir>/ctrf-report.json). ' +
        'Use it to put several tiers side by side in one directory for `report aggregate`.',
    )
    .option(
      '--base-url <url>',
      'preview/staging URL for the route-scoped a11y + performance-budget tiers (or $WARDEN_BASE_URL)',
    )
    .option(
      '--base <sha>',
      'base git ref/sha — enables the a11y/perf tiers to scope to changed routes',
    )
    .option('--head <sha>', 'head git ref/sha for the change-surface diff')
    .option(
      '--impact-index <path>',
      'coverage index JSON — narrows the run to the tests the diff impacts (needs --base/--head)',
    )
    .option(
      '--db <path>',
      'SQLite store to persist this run into (builds flake history across runs; feeds the dashboard)',
    )
    .action(
      async (opts: {
        grep?: string;
        cwd?: string;
        artifactsDir: string;
        output?: string;
        baseUrl?: string;
        base?: string;
        head?: string;
        impactIndex?: string;
        db?: string;
      }) => {
        try {
          const cwd = opts.cwd ?? process.cwd();
          const baseUrl = opts.baseUrl ?? env.WARDEN_BASE_URL;
          const runDeps: Parameters<typeof runRun>[1] = {};
          if (deps.runTests) runDeps.runTests = deps.runTests;
          let grep = opts.grep;
          // Wire the route-scoped a11y/perf tiers and the CUJ-scoped gate when they're enabled and
          // we have a diff to scope from. Both reuse one computed change surface; the a11y/perf
          // tiers also need a deployment URL. Without a diff (--base/--head), `run` behaves
          // exactly as before.
          if (opts.base && opts.head) {
            const cfg = await loadConfig(cwd);
            const needQuality =
              Boolean(baseUrl) && (cfg.a11y.enabled || cfg.performance.browser.enabled);
            const needCuj = cfg.cuj.enabled;
            const needImpact = Boolean(opts.impactIndex) && cfg.impact.enabled;
            if (needQuality || needCuj || needImpact) {
              const changeSurface = await analyzeChangeSurface(opts.base, opts.head, cfg, cwd);
              runDeps.config = cfg;
              if (needQuality && baseUrl) {
                runDeps.qualityAudits = { changeSurface, baseUrl };
              }
              if (needCuj) {
                runDeps.cuj = {
                  source: fsCujSource(),
                  changeSurface,
                  baseRef: opts.base,
                  parse: parseYaml,
                };
              }
              // Test impact analysis: narrow --grep to only the tests the diff impacts.
              if (needImpact && opts.impactIndex) {
                const raw = await readFile(opts.impactIndex, 'utf-8').catch(() => null);
                if (raw) {
                  const sel = selectWithImpact(changeSurface, loadCoverageIndex(raw), cfg);
                  if (!sel.runAll && sel.grep) grep = sel.grep;
                }
              }
            }
          }
          // Persist the run when asked, so flake history builds across runs and the dashboard
          // snapshot can render it. Off by default — nothing writes a DB unless --db is given.
          const store = opts.db ? new SqliteStore(opts.db) : undefined;
          if (store) runDeps.store = store;
          try {
            const result = await runRun(
              {
                grep,
                cwd: opts.cwd,
                artifactsDir: opts.artifactsDir,
                ...(opts.output ? { ctrfPath: opts.output } : {}),
              },
              runDeps,
            );
            stdout.write(`wrote CTRF report to ${result.ctrfPath}\n`);
            if (opts.db) stdout.write(`persisted run to ${opts.db}\n`);
            // The gate this tier computed is the reason the step passes or fails, so say it and
            // then exit on it. Printing it is not decoration: without the line, a step that fails
            // with "wrote CTRF report to …" as its last word gives no reason at all.
            stdout.write(`gate: ${result.gate.decision} — ${result.gate.reason}\n`);
            applyGateExitCode(result.gate, proc);
          } finally {
            store?.close();
          }
        } catch (err) {
          fail(err);
        }
      },
    );

  program
    .command('agent')
    .description('Run an AI agent strategy (exploratory | generative | healer)')
    .requiredOption('--strategy <name>', 'exploratory | generative | healer')
    .option('--url <url>', 'target URL for the exploratory strategy')
    .option('--pr-number <n>', 'the PR this run is associated with', (v) => Number.parseInt(v, 10))
    .requiredOption('--output <path>', 'path the AgentOutput JSON is written to')
    .option('--cwd <dir>', 'working directory config is loaded from')
    .option('--provider <name>', 'override ai.provider: anthropic | openai | gemini | ollama')
    .option('--model <id>', 'override ai.model for this run')
    .option(
      '--stub-provider',
      'call no model — exercise the wiring without spending tokens; the report says so',
    )
    .action(
      async (opts: {
        strategy: string;
        url?: string;
        prNumber?: number;
        output: string;
        cwd?: string;
        provider?: string;
        model?: string;
        stubProvider?: boolean;
      }) => {
        try {
          if (opts.stubProvider) {
            stderr.write(
              'warden: --stub-provider, no model will be called; the report is not a result\n',
            );
          }
          const result = await runAgent({
            strategy: opts.strategy as StrategyName,
            url: opts.url,
            prNumber: opts.prNumber,
            output: opts.output,
            cwd: opts.cwd,
            provider: opts.provider,
            model: opts.model,
            stubProvider: opts.stubProvider,
          });
          // Naming the provider on stdout is the same claim the report's `provider` field makes:
          // a reader of the log can tell a real run from one that called nothing.
          stdout.write(
            `wrote agent report to ${opts.output} (provider: ${result.provider ?? 'unknown'})\n`,
          );
        } catch (err) {
          fail(err);
        }
      },
    );

  /**
   * Writes the gate outcome once, in whichever of the two registers was asked for.
   *
   * `--json` is what a CI integration reads, so under it stdout must be nothing but the
   * `GateReport` — the human line moves to stderr, where a person watching the log still
   * sees it and no parser has to guess which bytes were meant for it.
   */
  const writeGateOutcome = (result: RunReportResult, asJson: boolean): void => {
    const human = `gate: ${result.gate.decision} — ${result.gate.reason}\n`;
    if (!asJson) {
      stdout.write(human);
      return;
    }
    stdout.write(`${JSON.stringify(toGateReport(result), null, 2)}\n`);
    stderr.write(human);
  };

  const report = program.command('report').description('Reporting commands');

  report
    .command('aggregate')
    .description('Aggregate CTRF reports and post the gate comment on a PR')
    .requiredOption('--reports <dir>', 'directory of CTRF report JSON files to merge')
    .requiredOption('--pr <n>', 'pull request number', (v) => Number.parseInt(v, 10))
    .option('--artifacts-dir <dir>', 'directory recorded in the ReportContext')
    .option(
      '--head-sha <sha>',
      'commit the check run attaches to. Defaults to $GITHUB_SHA / $CI_COMMIT_SHA — but on a ' +
        'pull_request event those name the merge commit, and a required check is read off the ' +
        "PR's head commit, so pass github.event.pull_request.head.sha there",
    )
    .option(
      '--json',
      'print the machine-readable gate report on stdout (the human line moves to stderr)',
    )
    .action(
      async (opts: {
        reports: string;
        pr: number;
        artifactsDir?: string;
        headSha?: string;
        json?: boolean;
      }) => {
        try {
          const cfg = await loadConfig();

          // Non-GitHub hosts route through the configured VcsProvider; GitHub keeps the
          // existing direct octokit path so nothing changes for current users.
          if (cfg.vcs.provider !== 'github') {
            const vcs = createVcsProviderFromEnv(cfg, env);
            const repoRef = resolveVcsRepoRef(cfg, env);
            const headSha = opts.headSha ?? resolveVcsHeadSha(cfg, env);
            const result = await runReport(
              { reports: opts.reports, pr: opts.pr, artifactsDir: opts.artifactsDir },
              { config: cfg, vcs, repoRef, ...(headSha !== undefined && { headSha }) },
            );
            writeGateOutcome(result, opts.json === true);
            applyGateExitCode(result.gate, proc);
            return;
          }

          const token = env.GITHUB_TOKEN;
          if (!token) {
            throw new Error('GITHUB_TOKEN is required to post the PR comment');
          }
          const [owner, repoName] = (env.GITHUB_REPOSITORY ?? '/').split('/');
          if (!owner || !repoName) {
            throw new Error('GITHUB_REPOSITORY (owner/repo) is required to post the PR comment');
          }

          const octokit = createFetchOctokit({ token });
          const result = await runReport(
            { reports: opts.reports, pr: opts.pr, artifactsDir: opts.artifactsDir },
            {
              config: cfg,
              octokit,
              repo: { owner, repo: repoName },
              headSha: opts.headSha ?? env.GITHUB_SHA,
            },
          );
          writeGateOutcome(result, opts.json === true);
          applyGateExitCode(result.gate, proc);
        } catch (err) {
          fail(err);
        }
      },
    );

  const visual = program.command('visual').description('Visual regression commands');

  visual
    .command('approve')
    .description('Approve (promote) a pending visual baseline for a module')
    .argument('<module>', 'module whose baseline is approved (e.g. apps/checkout)')
    .option('--viewport <name>', 'viewport name', 'desktop')
    .option('--theme <theme>', 'theme (light | dark)', 'light')
    .option('--by <who>', 'who is approving (audit trail)')
    .action(async (module: string, opts: { viewport: string; theme: string; by?: string }) => {
      try {
        const result = await runVisualApprove({
          module,
          viewport: opts.viewport,
          theme: opts.theme === 'dark' ? 'dark' : 'light',
          by: opts.by,
        });
        const committed = result.committed ? ' (committed)' : '';
        stdout.write(`approved visual baseline: ${result.baseline.path}${committed}\n`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command('plan')
    .description('Emit the canonical Test Plan Markdown template')
    .option('--name <name>', 'feature or release name')
    .action((opts: { name?: string }) => {
      stdout.write(`${runPlan(opts)}\n`);
    });

  program
    .command('init')
    .description('Scaffold warden.config.ts and a sample AI-QA GitHub Actions workflow')
    .option('--cwd <dir>', 'directory to scaffold into', process.cwd())
    .option('--force', 'replace existing files without asking', false)
    .action(async (opts: { cwd: string; force?: boolean }) => {
      try {
        const result = await runInit({
          cwd: opts.cwd,
          force: opts.force === true,
          confirmOverwrite: createOverwriteConfirm({
            input: process.stdin,
            output: process.stdout,
          }),
        });
        let kept = 0;
        for (const file of result.files) {
          switch (file.status) {
            case 'created':
              stdout.write(`created ${file.path}\n`);
              break;
            case 'overwritten':
              stdout.write(`overwrote ${file.path}\n`);
              break;
            case 'unchanged':
              stdout.write(`unchanged ${file.path} (already matches the template)\n`);
              break;
            case 'kept':
              kept += 1;
              stdout.write(`kept ${file.path} (exists and differs — not overwritten)\n`);
              break;
          }
        }
        if (kept > 0) {
          stdout.write(`re-run with --force to replace ${kept === 1 ? 'it' : 'them'}\n`);
        }
      } catch (err) {
        fail(err);
      }
    });

  return program;
}
