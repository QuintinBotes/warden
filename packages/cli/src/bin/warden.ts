#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, type StrategyName } from '@warden/core';
import { analyzeChangeSurface } from '@warden/orchestrator';
import { readFile } from 'node:fs/promises';
import { load as parseYaml } from 'js-yaml';
import { loadCoverageIndex, selectWithImpact } from '@warden/impact';
import { fsCujSource } from '../cuj-gate.js';
import {
  createFetchOctokit,
  createVcsProviderFromEnv,
  resolveVcsHeadSha,
  resolveVcsRepoRef,
  runAgent,
  runAnalyze,
  runInit,
  runPlan,
  runReport,
  runRun,
  runVisualApprove,
} from '../index';

const program = new Command();

program.name('warden').description('Warden — the AI QA platform CLI').version('0.1.0');

function fail(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`warden: ${message}\n`);
  process.exitCode = 1;
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
      const content = await runAnalyze(opts);
      if (!opts.output) {
        process.stdout.write(content);
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
  .action(
    async (opts: {
      grep?: string;
      cwd?: string;
      artifactsDir: string;
      baseUrl?: string;
      base?: string;
      head?: string;
      impactIndex?: string;
    }) => {
      try {
        const cwd = opts.cwd ?? process.cwd();
        const baseUrl = opts.baseUrl ?? process.env.WARDEN_BASE_URL;
        const deps: Parameters<typeof runRun>[1] = {};
        let grep = opts.grep;
        // Wire the route-scoped a11y/perf tiers and the CUJ-scoped gate when they're enabled and we
        // have a diff to scope from. Both reuse one computed change surface; the a11y/perf tiers also
        // need a deployment URL. Without a diff (--base/--head), `run` behaves exactly as before.
        if (opts.base && opts.head) {
          const cfg = await loadConfig(cwd);
          const needQuality =
            Boolean(baseUrl) && (cfg.a11y.enabled || cfg.performance.browser.enabled);
          const needCuj = cfg.cuj.enabled;
          const needImpact = Boolean(opts.impactIndex) && cfg.impact.enabled;
          if (needQuality || needCuj || needImpact) {
            const changeSurface = await analyzeChangeSurface(opts.base, opts.head, cfg, cwd);
            deps.config = cfg;
            if (needQuality && baseUrl) {
              deps.qualityAudits = { changeSurface, baseUrl };
            }
            if (needCuj) {
              deps.cuj = {
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
        const result = await runRun({ grep, cwd: opts.cwd, artifactsDir: opts.artifactsDir }, deps);
        process.stdout.write(`wrote CTRF report to ${result.ctrfPath}\n`);
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
  .action(
    async (opts: {
      strategy: string;
      url?: string;
      prNumber?: number;
      output: string;
      cwd?: string;
    }) => {
      try {
        await runAgent({
          strategy: opts.strategy as StrategyName,
          url: opts.url,
          prNumber: opts.prNumber,
          output: opts.output,
          cwd: opts.cwd,
        });
        process.stdout.write(`wrote agent report to ${opts.output}\n`);
      } catch (err) {
        fail(err);
      }
    },
  );

const report = program.command('report').description('Reporting commands');

report
  .command('aggregate')
  .description('Aggregate CTRF reports and post the gate comment on a PR')
  .requiredOption('--reports <dir>', 'directory of CTRF report JSON files to merge')
  .requiredOption('--pr <n>', 'pull request number', (v) => Number.parseInt(v, 10))
  .option('--artifacts-dir <dir>', 'directory recorded in the ReportContext')
  .action(async (opts: { reports: string; pr: number; artifactsDir?: string }) => {
    try {
      const cfg = await loadConfig();

      // Non-GitHub hosts route through the configured VcsProvider; GitHub keeps the
      // existing direct octokit path so nothing changes for current users.
      if (cfg.vcs.provider !== 'github') {
        const vcs = createVcsProviderFromEnv(cfg, process.env);
        const repoRef = resolveVcsRepoRef(cfg, process.env);
        const headSha = resolveVcsHeadSha(cfg, process.env);
        const result = await runReport(
          { reports: opts.reports, pr: opts.pr, artifactsDir: opts.artifactsDir },
          { config: cfg, vcs, repoRef, ...(headSha !== undefined && { headSha }) },
        );
        process.stdout.write(`gate: ${result.gate.decision} — ${result.gate.reason}\n`);
        return;
      }

      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        throw new Error('GITHUB_TOKEN is required to post the PR comment');
      }
      const [owner, repoName] = (process.env.GITHUB_REPOSITORY ?? '/').split('/');
      if (!owner || !repoName) {
        throw new Error('GITHUB_REPOSITORY (owner/repo) is required to post the PR comment');
      }

      const octokit = createFetchOctokit({ token });
      const result = await runReport(
        { reports: opts.reports, pr: opts.pr, artifactsDir: opts.artifactsDir },
        { config: cfg, octokit, repo: { owner, repo: repoName }, headSha: process.env.GITHUB_SHA },
      );
      process.stdout.write(`gate: ${result.gate.decision} — ${result.gate.reason}\n`);
    } catch (err) {
      fail(err);
    }
  });

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
      process.stdout.write(`approved visual baseline: ${result.baseline.path}${committed}\n`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command('plan')
  .description('Emit the canonical Test Plan Markdown template')
  .option('--name <name>', 'feature or release name')
  .action((opts: { name?: string }) => {
    process.stdout.write(`${runPlan(opts)}\n`);
  });

program
  .command('init')
  .description('Scaffold warden.config.ts and a sample AI-QA GitHub Actions workflow')
  .option('--cwd <dir>', 'directory to scaffold into', process.cwd())
  .action(async (opts: { cwd: string }) => {
    try {
      const result = await runInit({ cwd: opts.cwd });
      process.stdout.write(`created ${result.configPath}\n`);
      process.stdout.write(`created ${result.workflowPath}\n`);
    } catch (err) {
      fail(err);
    }
  });

await program.parseAsync(process.argv);
