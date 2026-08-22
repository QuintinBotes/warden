/**
 * The Warden GitHub Action entry point.
 *
 * `run(deps)` orchestrates the tiered AI-QA pipeline from the blueprint (Part IV)
 * at a logical level by shelling the `warden` CLI, then emits the four reporting
 * surfaces and the action outputs:
 *
 *   analyze diff  →  smoke tier  →  selective / full regression tier
 *   →  AI exploratory agent (when risk ≥ threshold, or unmeasured)  →  aggregate + gate
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
import {
  buildAnnotations,
  checkTitle,
  gateToConclusion,
  renderIncompleteTiers,
  renderPrReport,
  renderUnknownChangeSurface,
} from './report.js';
import type { AgentTierOutcome } from './report.js';
import type { ActionsCoreLike, ActionDeps, RunResult, TierFailure } from './types.js';
import { aggregate, analyze, runAgent, runTier } from './warden-cli.js';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run one pipeline tier. A crash is caught rather than rethrown so the remaining tiers still run
 * and their results still reach the reader — but it is *recorded*, not merely logged: a tier that
 * crashed wrote no report file, so the aggregate that follows scores whichever tiers survived.
 * `incomplete` is what later forces that partial verdict closed to `BLOCK`.
 *
 * It also returns the failure message, or `undefined` on success. A caller that reports on what
 * the tier produced needs that message: a line in the job log is invisible next to a PR comment,
 * so a failure that is never returned is how the report ends up describing a tier that never ran.
 */
async function tier(
  core: ActionsCoreLike,
  incomplete: TierFailure[],
  name: string,
  fn: () => Promise<void>,
): Promise<string | undefined> {
  try {
    await fn();
    core.info(`Warden: tier '${name}' completed.`);
    return undefined;
  } catch (err) {
    const message = errMsg(err);
    // `error`, not `warning`: this ends the run red, and a collapsed warning line was exactly how
    // a lost tier used to pass for a green check.
    core.error(`Warden: tier '${name}' did not complete: ${message}`);
    incomplete.push({ name, message });
    return message;
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
      // Nothing was analyzed, so there is no score. `0` here would be the same fabrication one
      // branch further out: an unmeasured surface reported as the safest one.
      riskScore: null,
      reportPath: '',
      testTags: '',
      ranAgent: false,
      commentPosted: false,
      checkRunCreated: false,
      skipped: true,
      incompleteTiers: [],
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
  // `reportsDir` is handed to `warden report aggregate --reports`, which parses *every* `*.json`
  // directly inside it as a CTRF report. Only tier reports may live there: an agent report dropped
  // beside them fails the merge, and the merge failing is the whole gate failing.
  const reportsDir = env.WARDEN_REPORTS_DIR || 'warden-reports';
  const artifactsDir = env.WARDEN_ARTIFACTS_DIR || 'warden-artifacts';
  const appUrl = env.WARDEN_BASE_URL || 'http://localhost:3000';
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    ANTHROPIC_API_KEY: apiKey,
    WARDEN_PROVIDER: provider,
    ...(model ? { WARDEN_MODEL: model } : {}),
  };
  const execOpts = { env: childEnv, cwd };

  // ── Tier: analyze the change surface ────────────────────────────────────────
  // `warden analyze` shells `git diff <base> <head>`, which cannot run when the base commit is not
  // in the clone — `actions/checkout` defaults to `fetch-depth: 1` and leaves it out. What comes
  // back then is *no answer*, and every value below used to default as though it were one: risk 0,
  // no tags, no full suite. That is the most permissive reading of a measurement never taken, and
  // it deselected the whole pipeline while the report said "0/10 (LOW)".
  let analysis: Record<string, string> = {};
  let unknownChangeSurface: string | null = null;
  try {
    analysis = await analyze(exec, { baseSha: pr.baseSha, headSha: pr.headSha, ...execOpts });
  } catch (err) {
    unknownChangeSurface = errMsg(err);
  }
  // `Number('')` is 0, so an empty `risk_score=` line would otherwise land as a measured zero.
  const rawRisk = analysis.risk_score?.trim() ?? '';
  if (unknownChangeSurface === null && !Number.isFinite(Number(rawRisk || NaN))) {
    // A completed `analyze` that named no score is the same absence, arriving quietly.
    unknownChangeSurface =
      rawRisk === ''
        ? '`warden analyze` completed but reported no risk_score.'
        : `\`warden analyze\` reported an unreadable risk_score: ${JSON.stringify(rawRisk)}.`;
  }

  const testTags = unknownChangeSurface === null ? (analysis.test_tags ?? '') : '';
  /** `null` means never measured: not comparable to the threshold, and never printed as a number. */
  const riskScore: number | null = unknownChangeSurface === null ? Number(rawRisk) : null;
  // An unknown scope escalates to the full suite. The old fallback ran `@smoke` twice and nothing
  // else at all — a narrower run than the one the user asked for, chosen on no evidence.
  const runFullSuite =
    unknownChangeSurface === null ? (analysis.run_full_suite ?? 'false') === 'true' : true;
  if (unknownChangeSurface === null) {
    core.info(
      `Warden: change surface tags="${testTags}" risk=${riskScore}/10 fullSuite=${runFullSuite}`,
    );
  } else {
    // `error`, not `warning`: this decides what the whole pipeline runs, and it is the line the
    // reader needs when every surface says "unknown".
    core.error(
      `Warden: change surface unknown (${unknownChangeSurface}) — running the full @regression ` +
        `suite and the AI exploratory agent, and reporting risk as unknown.`,
    );
  }

  // Provenance of the three numbers above. An absent `warden.config` scores identically to an
  // empty one, so only the CLI can tell them apart — and a CLI that did not say (an older one,
  // or an `analyze` that failed) leaves this `undefined`, which is not a claim either way.
  const configured = analysis.configured === undefined ? undefined : analysis.configured === 'true';
  if (configured === false) {
    core.warning(
      'Warden: no warden.config found in this repository — the risk score, the tier selection ' +
        "and the gate below used Warden's built-in defaults, not this repository's. Run " +
        '`npx warden init` to configure it.',
    );
  }

  // Tiers that crashed. Collected across the pipeline and applied to the gate below.
  const incompleteTiers: TierFailure[] = [];

  // ── Tier: smoke ─────────────────────────────────────────────────────────────
  await tier(core, incompleteTiers, 'smoke', () =>
    runTier(exec, {
      grep: '@smoke',
      output: path.join(reportsDir, 'smoke.ctrf.json'),
      artifactsDir: path.join(artifactsDir, 'smoke'),
      ...execOpts,
    }),
  );

  // ── Tier: selective regression (or full suite when escalated) ───────────────
  // No tags and no escalation means the change surface scoped to nothing — usually a repo
  // whose modules are not under the default `scope.modulePaths`. The tier still runs, but as
  // smoke again, so say so: a silent re-run of smoke labelled "regression" reads as coverage
  // that was never measured.
  if (!runFullSuite && !testTags) {
    core.warning(
      'Warden: the change surface produced no test tags, so the regression tier re-runs @smoke. ' +
        "If this repo's modules are not under apps/ or src/features/, set scope.modulePaths in warden.config.ts.",
    );
  }
  const regressionGrep = runFullSuite ? '@regression' : testTags || '@smoke';
  // The regression tier also carries the diff bounds + preview URL, so `warden run` folds the
  // route-scoped a11y/perf tiers and the CUJ-scoped gate into this (comprehensive) run — once.
  await tier(core, incompleteTiers, 'regression', () =>
    runTier(exec, {
      grep: regressionGrep,
      output: path.join(reportsDir, 'regression.ctrf.json'),
      artifactsDir: path.join(artifactsDir, 'regression'),
      baseSha: pr.baseSha,
      headSha: pr.headSha,
      ...(baseUrl ? { baseUrl } : {}),
      ...execOpts,
    }),
  );

  // ── Tier: AI exploratory agent (risk-gated) ─────────────────────────────────
  // Whatever happens here is what the report is allowed to say about bugs; see AgentTierOutcome.
  let agentOutcome: AgentTierOutcome = {
    ran: false,
    reason: `risk ${riskScore} is below the threshold of ${riskThreshold}, so the tier was skipped`,
  };
  // An unknown risk is not a risk below the threshold. The gate decides when the agent is needed,
  // and a diff nobody read cannot answer that question in the agent's favour.
  if (riskScore === null || riskScore >= riskThreshold) {
    const failure = await tier(core, incompleteTiers, 'agent', () =>
      runAgent(exec, {
        strategy,
        url: appUrl,
        prNumber: pr.number,
        provider,
        model: model || undefined,
        // Deliberately not under `reportsDir`: an AgentOutput is not a CTRF report, and the
        // aggregate step parses every `*.json` there as one.
        output: path.join(artifactsDir, 'exploratory.json'),
        ...execOpts,
      }),
    );
    agentOutcome =
      failure === undefined ? { ran: true } : { ran: false, reason: `the tier failed: ${failure}` };
  } else {
    core.info(
      `Warden: risk ${riskScore} < threshold ${riskThreshold}; skipping AI exploratory agent.`,
    );
  }
  const ranAgent = agentOutcome.ran;

  // ── Tier: aggregate + gate ──────────────────────────────────────────────────
  let report: AggregateReport;
  try {
    report = await aggregate(exec, { reportsDir, prNumber: pr.number, ...execOpts });
  } catch (err) {
    // Fail closed: a gate that could not be evaluated must not post a green check that unblocks
    // the merge. Surface the crash as a BLOCK rather than defaulting to PASS.
    core.warning(`Warden: aggregate failed: ${errMsg(err)}`);
    report = {
      gate: { decision: 'BLOCK', reason: `aggregate failed — gate not evaluated: ${errMsg(err)}` },
    };
  }
  // Fail closed: a tier that did not complete wrote no results, so the aggregate above scored only
  // the tiers that survived. `PASS` over an unknown subset of the suite is not a verdict — and the
  // regression tier, the one most likely to be lost to a browser crash or an evicted runner, is
  // precisely the tier selected to cover this diff.
  if (incompleteTiers.length > 0) {
    const noun = incompleteTiers.length === 1 ? 'tier' : 'tiers';
    const detail = incompleteTiers.map((t) => `${t.name} (${t.message})`).join('; ');
    report = {
      ...report,
      gate: {
        decision: 'BLOCK',
        reason:
          `${incompleteTiers.length} ${noun} did not complete: ${detail} — the gate was ` +
          `evaluated on the tiers that wrote results, which reported ` +
          `${report.gate.decision}: ${report.gate.reason}`,
      },
    };
  }

  const gate = report.gate.decision;
  const reportPath = report.reportPath ?? path.join(reportsDir, 'warden-ctrf.json');

  const baseMarkdown =
    report.markdown ??
    renderPrReport({
      prNumber: pr.number,
      riskScore,
      riskThreshold,
      gate: report.gate,
      summary: report.summary,
      findings: report.findings,
      testTags,
      agent: agentOutcome,
      ...(configured !== undefined && { configured }),
    });
  const notice = [
    renderUnknownChangeSurface(unknownChangeSurface),
    renderIncompleteTiers(incompleteTiers),
  ]
    .filter(Boolean)
    .join('\n\n');
  const markdown = notice ? `${notice}\n\n${baseMarkdown}` : baseMarkdown;

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
        title: checkTitle(gate, report.summary, incompleteTiers),
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
  // `unknown`, not `0`: a workflow comparing this output must not read a surface that was never
  // measured as the safest score there is.
  core.setOutput('risk-score', riskScore === null ? 'unknown' : String(riskScore));
  core.setOutput('report-path', reportPath);
  core.setOutput('incomplete-tiers', incompleteTiers.map((t) => t.name).join(','));
  // Only set when it is known, so a consumer branching on it never reads an invented 'true'.
  if (configured !== undefined) core.setOutput('configured', String(configured));

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
    incompleteTiers,
    ...(configured !== undefined && { configured }),
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
