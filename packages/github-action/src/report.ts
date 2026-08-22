/**
 * Rendering for two of the four reporting surfaces:
 *  - the Markdown PR report (reused for the PR comment AND the job summary), and
 *  - the GitHub Check-Run payload (title + file/line annotations).
 *
 * The Markdown mirrors the blueprint's "AI QA Report" template (Part VI).
 */
import type { ExploratoryFinding, Severity } from '@warden/core';
import { escapeMarkdownCell } from '@warden/core';
import type { AggregateFailure, AggregateSummary } from './parse.js';
import type { CheckAnnotation, CreateCheckParams, GateVerdict, TierFailure } from './types.js';

/** Map a gate verdict onto a GitHub Check-Run conclusion. */
export function gateToConclusion(gate: GateVerdict): NonNullable<CreateCheckParams['conclusion']> {
  switch (gate) {
    case 'BLOCK':
      return 'failure';
    case 'WARN':
      return 'neutral';
    default:
      return 'success';
  }
}

const GATE_LABEL: Record<GateVerdict, string> = {
  BLOCK: '❌ BLOCK MERGE',
  WARN: '⚠️ WARN',
  PASS: '✅ PASS',
};

const SEVERITY_ORDER: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** Translate aggregate failures into GitHub Check annotations (Surface 3). */
export function buildAnnotations(failures: AggregateFailure[]): CheckAnnotation[] {
  const annotations: CheckAnnotation[] = [];
  for (const f of failures) {
    if (!f.path) continue;
    const line = typeof f.line === 'number' && f.line > 0 ? f.line : 1;
    const level: CheckAnnotation['annotation_level'] =
      f.annotation_level ?? (f.priority === 'P1' ? 'failure' : 'warning');
    annotations.push({
      path: f.path,
      start_line: line,
      end_line: line,
      annotation_level: level,
      message: f.message,
      ...(f.title ? { title: f.title } : {}),
    });
  }
  return annotations;
}

/**
 * What the AI exploratory agent tier actually did.
 *
 * The report is published to a PR, so "no bugs found" is a positive claim about a run that has
 * to have happened. `ran: false` carries the reason it did not, and a caller that cannot say
 * either way omits the field — the renderer then makes no bug claim at all.
 */
export type AgentTierOutcome = { ran: true } | { ran: false; reason: string };

export interface PrReportInput {
  prNumber: number;
  /**
   * The change-surface risk score, or `null` when it was never measured — `warden analyze` did
   * not complete, or reported no score. `null` is rendered as "unknown", never as a number: a
   * reader cannot tell a fabricated `0` from a measured one, and both read as "safe to merge".
   */
  riskScore: number | null;
  riskThreshold?: number;
  gate: { decision: GateVerdict; reason: string };
  summary?: AggregateSummary;
  findings?: ExploratoryFinding[];
  testTags?: string;
  /** Whether the exploratory agent ran. Omitted means "not recorded", never "it ran clean". */
  agent?: AgentTierOutcome;
  /**
   * Whether the repository had a `warden.config`. Omit when it was never established — the note
   * below is a statement of fact about the run, so it is only rendered for a definite `false`.
   */
  configured?: boolean;
}

function riskBand(score: number): string {
  if (score >= 7) return 'HIGH';
  if (score >= 4) return 'MEDIUM';
  return 'LOW';
}

function renderFinding(f: ExploratoryFinding): string {
  const lines = [`#### [${f.severity}] ${f.title}`];
  if (f.steps.length > 0) lines.push(`- **Steps:** ${f.steps.join(' → ')}`);
  lines.push(`- **Expected:** ${f.expected}`);
  lines.push(`- **Actual:** ${f.actual}`);
  if (f.screenshotPath) lines.push(`- **Screenshot:** [view](${f.screenshotPath})`);
  if (f.requirementIds && f.requirementIds.length > 0) {
    lines.push(`- **Requirement:** ${f.requirementIds.join(', ')}`);
  }
  return lines.join('\n');
}

/** Render the Markdown "AI QA Report" used for the PR comment and job summary. */
export function renderPrReport(input: PrReportInput): string {
  const { prNumber, riskScore, gate, summary, testTags, agent, configured } = input;
  const findings = [...(input.findings ?? [])].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const parts: string[] = [];
  parts.push(`## 🤖 Warden AI QA Report — PR #${prNumber}`);
  parts.push('');

  if (riskScore === null) {
    // No band, no denominator: there is no number here to qualify.
    parts.push(
      '**Risk Score:** unknown — the change surface was not analyzed, so this PR was not scored.',
    );
  } else {
    const bandNote = testTags
      ? ` (${riskBand(riskScore)} — changed: ${testTags})`
      : ` (${riskBand(riskScore)})`;
    parts.push(`**Risk Score:** ${riskScore}/10${bandNote}`);
  }

  if (configured === false) {
    // Warden's defaults are opinionated guesses about layout and naming, not a neutral baseline,
    // and an absent config scores exactly like an empty one. Without this line a green check on
    // an unconfigured repository reads as a verdict the repository never asked for.
    parts.push('');
    parts.push(
      '> ⚠️ No `warden.config` was found in this repository. The risk score and the tiers that ' +
        "ran are Warden's built-in defaults, not this repository's — run `npx warden init` to " +
        'configure them.',
    );
  }
  if (summary) {
    const pct = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 100;
    const mark = summary.failed === 0 ? '✅' : '❌';
    parts.push(
      `**Test Coverage:** ${summary.passed}/${summary.total} tests passing ${mark} (${pct}%)`,
    );
  }
  parts.push('');

  if (findings.length > 0) {
    parts.push(`### 🐛 Bugs Found (${findings.length})`);
    parts.push('');
    parts.push(findings.map(renderFinding).join('\n\n'));
    parts.push('');
  } else if (agent?.ran === true) {
    parts.push('### 🐛 Bugs Found (0)');
    parts.push('');
    parts.push('No bugs found by the AI exploratory agent. ✅');
    parts.push('');
  } else {
    // A count of zero is a measurement, and there was none: an agent that was skipped or that
    // crashed found nothing because it never looked. Saying so is the whole point of the section.
    const why = agent ? agent.reason : 'its outcome was not recorded for this run';
    parts.push('### 🐛 Bugs Found (not measured)');
    parts.push('');
    parts.push(
      `The AI exploratory agent did not report on this PR — ${why}. ` +
        'This report makes no claim about bugs it might have found.',
    );
    parts.push('');
  }

  if (summary) {
    parts.push('### ✅ Coverage Summary');
    parts.push('');
    parts.push('| Tests | Pass | Fail |');
    parts.push('|---|---|---|');
    parts.push(`| ${summary.total} | ${summary.passed} | ${summary.failed} |`);
    parts.push('');
  }

  parts.push(`### 🚦 QA Gate Decision: ${GATE_LABEL[gate.decision]}`);
  parts.push('');
  parts.push(gate.reason || 'All exit criteria met.');
  parts.push('');

  return parts.join('\n');
}

/**
 * Title for the Check-Run output block. A tier that did not complete outranks the failure count:
 * "3 failing of 47" invites the reader to trust the 44, and there is no reading of the 44 that is
 * true when a tier is missing from the total.
 */
export function checkTitle(
  gate: GateVerdict,
  summary?: AggregateSummary,
  incompleteTiers: readonly TierFailure[] = [],
): string {
  if (incompleteTiers.length > 0) {
    const names = incompleteTiers.map((t) => t.name).join(', ');
    const noun = incompleteTiers.length === 1 ? 'tier' : 'tiers';
    return `Warden QA: ${gate} — ${noun} did not complete: ${names}`;
  }
  if (summary && summary.failed > 0) {
    return `Warden QA: ${gate} — ${summary.failed} failing of ${summary.total}`;
  }
  return `Warden QA: ${gate}`;
}

/**
 * The banner that goes above the AI QA report when a tier did not complete. Rendered separately
 * from {@link renderPrReport} so it also fronts a pre-rendered Markdown report handed back by the
 * CLI — the one surface where the loss would otherwise be invisible.
 */
export function renderIncompleteTiers(failures: readonly TierFailure[]): string {
  if (failures.length === 0) return '';
  const noun = failures.length === 1 ? 'tier' : 'tiers';
  const lines = [
    `> ### ⛔ ${failures.length} ${noun} did not complete`,
    '>',
    `> These tiers wrote no results, so the gate below was evaluated on the tiers that survived —`,
    `> it is a verdict over part of the suite, not the whole of it.`,
    '>',
    '> | Tier | Error |',
    '> |---|---|',
    // A CLI error can arrive multi-line (a stack, a stderr blob) and can contain a pipe; either
    // one ends the table row early and hides the rest of the message.
    ...failures.map(
      (f) => `> | \`${f.name}\` | ${escapeMarkdownCell(f.message.replace(/\s+/g, ' ').trim())} |`,
    ),
  ];
  return lines.join('\n');
}

/**
 * The banner that goes above the AI QA report when the change surface could not be analyzed.
 *
 * Rendered separately from {@link renderPrReport} so it also fronts a pre-rendered Markdown
 * report handed back by the CLI — the one surface where the absence would otherwise be invisible.
 * It states the consequence and not only the error, because the reader's question is not "what
 * broke" but "what did Warden actually check".
 */
export function renderUnknownChangeSurface(reason: string | null): string {
  if (reason === null) return '';
  // A CLI error arrives multi-line (git's stderr, a stack), and a bare newline drops the rest of
  // it out of the blockquote; an unbalanced backtick swallows the prose that follows it.
  const oneLine = reason.replace(/\s+/g, ' ').trim().replace(/`/g, "'");
  return [
    '> ### ⚠️ Change surface not analyzed — risk is unknown, not low',
    '>',
    `> \`warden analyze\` did not produce a risk score, so this PR's diff was never read: ${oneLine}`,
    '>',
    '> Warden escalated rather than guessing: the **full** `@regression` suite ran in place of the',
    '> diff-scoped tier, and the AI exploratory agent ran regardless of the risk threshold. No part',
    '> of this run was targeted at your changes.',
    '>',
    '> The usual cause is a shallow checkout. `actions/checkout` defaults to `fetch-depth: 1`, which',
    "> leaves the PR's base commit out of the clone; set `fetch-depth: 0` on the checkout step.",
  ].join('\n');
}
