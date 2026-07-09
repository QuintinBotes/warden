/**
 * The Warden GitHub Action entry point.
 *
 * `run(deps)` orchestrates the tiered AI-QA pipeline from the blueprint (Part IV)
 * at a logical level by shelling the `warden` CLI, then emits the four reporting
 * surfaces and the action outputs:
 *
 *   analyze diff  →  smoke tier  →  selective / full regression tier
 *   →  AI exploratory agent (when risk ≥ threshold)  →  aggregate + gate
 *
 * Surfaces: (1) CTRF file (written by the CLI; exposed as `report-path`),
 * (2) `$GITHUB_STEP_SUMMARY` Markdown, (3) PR review comment, (4) Check-Run
 * with file/line annotations.
 *
 * Every collaborator is injected via {@link ActionDeps}; the defaults are only
 * reached in a real Action, never in unit tests.
 */
import { posix as path } from 'node:path';
import type { PullRequest } from '@warden/core';
import { firePluginHooks } from '@warden/orchestrator';
import { defaultExec, defaultFs, resolveCore, resolveOctokit } from './defaults.js';
import { loadPrEvent, resolveRepo } from './event.js';
import type { PrContext } from './event.js';
import type { AggregateReport } from './parse.js';
import { buildAnnotations, checkTitle, gateToConclusion, renderPrReport } from './report.js';
import type { ActionsCoreLike, ActionDeps, RunResult } from './types.js';
import { aggregate, analyze, runAgent, runTier } from './warden-cli.js';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Run one pipeline tier, downgrading a failure to a warning so the gate still runs. */
async function tier(core: ActionsCoreLike, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    core.info(`Warden: tier '${name}' completed.`);
  } catch (err) {
    core.warning(`Warden: tier '${name}' failed: ${errMsg(err)}`);
  }
}

export async function run(deps: ActionDeps = {}): Promise<RunResult> {
  const core = await resolveCore(deps.core);
  const env = deps.env ?? process.env;
  const exec = deps.exec ?? defaultExec;
  const fs = deps.fs ?? defaultFs;
  const eventPath = deps.eventPath ?? env.GITHUB_EVENT_PATH;

  // ── Inputs ────────────────────────────────────────────────────────────────
  const provider = core.getInput('provider') || 'anthropic';
  const model = core.getInput('model');
  const strategy = core.getInput('strategy') || 'exploratory';
  const riskThreshold = Number(core.getInput('risk-threshold') || '4') || 4;
  const apiKey = core.getInput('anthropic-api-key', { required: true });
  // Preview/staging URL for the route-scoped a11y + performance-budget tiers (input wins over env).
  const baseUrl = core.getInput('base-url') || process.env.WARDEN_BASE_URL || '';

  // ── PR context ──────────────────────────────────────────────────────────────
  const pr: PrContext | null = loadPrEvent(eventPath, fs);
  if (!pr) {
    core.info('Warden: no pull_request in the event payload; skipping AI QA gate.');
    return {
      gate: 'PASS',
      riskScore: 0,
      reportPath: '',
      testTags: '',
      ranAgent: false,
      commentPosted: false,
      checkRunCreated: false,
      skipped: true,
    };
  }
  const pluginPr: PullRequest = {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    headSha: pr.headSha,
    baseSha: pr.baseSha,
    ...(pr.author !== undefined && { author: pr.author }),
  };
  await firePluginHooks(deps.plugins ?? [], { hook: 'onPROpened', pr: pluginPr });

  const repo = resolveRepo(pr, env);

  const cwd = env.GITHUB_WORKSPACE || process.cwd();
  const reportsDir = env.WARDEN_REPORTS_DIR || 'warden-reports';
  const appUrl = env.WARDEN_BASE_URL || 'http://localhost:3000';
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    ANTHROPIC_API_KEY: apiKey,
    WARDEN_PROVIDER: provider,
    ...(model ? { WARDEN_MODEL: model } : {}),
  };
  const execOpts = { env: childEnv, cwd };

  // ── Tier: analyze the change surface ────────────────────────────────────────
  let analysis: Record<string, string> = {};
  try {
    analysis = await analyze(exec, { baseSha: pr.baseSha, headSha: pr.headSha, ...execOpts });
  } catch (err) {
    core.warning(`Warden: analyze failed, defaulting to smoke-only scope: ${errMsg(err)}`);
  }
  const testTags = analysis.test_tags ?? '';
  const riskScore = Number(analysis.risk_score ?? '0') || 0;
  const runFullSuite = (analysis.run_full_suite ?? 'false') === 'true';
  core.info(
    `Warden: change surface tags="${testTags}" risk=${riskScore}/10 fullSuite=${runFullSuite}`,
  );

  // ── Tier: smoke ─────────────────────────────────────────────────────────────
  await tier(core, 'smoke', () =>
    runTier(exec, {
      grep: '@smoke',
      output: path.join(reportsDir, 'smoke.ctrf.json'),
      ...execOpts,
    }),
  );

  // ── Tier: selective regression (or full suite when escalated) ───────────────
  const regressionGrep = runFullSuite ? '@regression' : testTags || '@smoke';
  // The regression tier also carries the diff bounds + preview URL, so `warden run` folds the
  // route-scoped a11y/perf tiers and the CUJ-scoped gate into this (comprehensive) run — once.
  await tier(core, 'regression', () =>
    runTier(exec, {
      grep: regressionGrep,
      output: path.join(reportsDir, 'regression.ctrf.json'),
      baseSha: pr.baseSha,
      headSha: pr.headSha,
      ...(baseUrl ? { baseUrl } : {}),
      ...execOpts,
    }),
  );

  // ── Tier: AI exploratory agent (risk-gated) ─────────────────────────────────
  let ranAgent = false;
  if (riskScore >= riskThreshold) {
    await tier(core, 'agent', async () => {
      await runAgent(exec, {
        strategy,
        url: appUrl,
        prNumber: pr.number,
        provider,
        model: model || undefined,
        output: path.join(reportsDir, 'exploratory.json'),
        ...execOpts,
      });
      ranAgent = true;
    });
  } else {
    core.info(
      `Warden: risk ${riskScore} < threshold ${riskThreshold}; skipping AI exploratory agent.`,
    );
  }

  // ── Tier: aggregate + gate ──────────────────────────────────────────────────
  let report: AggregateReport;
  try {
    report = await aggregate(exec, { reportsDir, prNumber: pr.number, ...execOpts });
  } catch (err) {
    core.warning(`Warden: aggregate failed: ${errMsg(err)}`);
    report = { gate: { decision: 'PASS', reason: 'No aggregated results available.' } };
  }
  const gate = report.gate.decision;
  const reportPath = report.reportPath ?? path.join(reportsDir, 'warden-ctrf.json');

  const markdown =
    report.markdown ??
    renderPrReport({
      prNumber: pr.number,
      riskScore,
      riskThreshold,
      gate: report.gate,
      summary: report.summary,
      findings: report.findings,
      testTags,
    });

  // ── Surface 2: GitHub job summary ───────────────────────────────────────────
  try {
    await core.summary.addRaw(markdown, true).write();
  } catch (err) {
    core.warning(`Warden: failed to write job summary: ${errMsg(err)}`);
  }

  // GitHub client is only needed for surfaces 3 & 4.
  const octokit = await resolveOctokit(deps.octokit, env);

  // ── Surface 3: PR review comment ────────────────────────────────────────────
  let commentPosted = false;
  try {
    await octokit.issues.createComment({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: pr.number,
      body: markdown,
    });
    commentPosted = true;
  } catch (err) {
    core.warning(`Warden: failed to post PR comment: ${errMsg(err)}`);
  }

  // ── Surface 4: Check-Run with annotations ───────────────────────────────────
  let checkRunCreated = false;
  try {
    const annotations = buildAnnotations(report.failures ?? []);
    await octokit.checks.create({
      owner: repo.owner,
      repo: repo.repo,
      name: 'Warden AI QA',
      head_sha: pr.headSha,
      status: 'completed',
      conclusion: gateToConclusion(gate),
      output: {
        title: checkTitle(gate, report.summary),
        summary: markdown,
        // GitHub caps a single checks.create at 50 annotations.
        annotations: annotations.slice(0, 50),
      },
    });
    checkRunCreated = true;
  } catch (err) {
    core.warning(`Warden: failed to create check run: ${errMsg(err)}`);
  }

  // ── Outputs (Surface 1 CTRF file is written by the CLI; exposed here) ────────
  core.setOutput('gate', gate);
  core.setOutput('risk-score', String(riskScore));
  core.setOutput('report-path', reportPath);

  if (gate === 'BLOCK') {
    core.setFailed(`Warden QA gate: BLOCK — ${report.gate.reason}`);
  }

  return {
    gate,
    riskScore,
    reportPath,
    testTags,
    ranAgent,
    commentPosted,
    checkRunCreated,
    skipped: false,
  };
}

/**
 * Real-Action entry: run the pipeline and translate any uncaught error into a
 * failed step. Wrapped so a thrown `WardenError` never crashes the runner opaquely.
 */
export async function main(deps: ActionDeps = {}): Promise<void> {
  try {
    await run(deps);
  } catch (err) {
    const core = await resolveCore(deps.core);
    core.setFailed(`Warden action failed: ${errMsg(err)}`);
  }
}
