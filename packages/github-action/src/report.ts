/**
 * Rendering for two of the four reporting surfaces:
 *  - the Markdown PR report (reused for the PR comment AND the job summary), and
 *  - the GitHub Check-Run payload (title + file/line annotations).
 *
 * The Markdown mirrors the blueprint's "AI QA Report" template (Part VI).
 */
import type { ExploratoryFinding, Severity } from '@warden/core';
import type { AggregateFailure, AggregateSummary } from './parse.js';
import type { CheckAnnotation, CreateCheckParams, GateVerdict } from './types.js';

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

export interface PrReportInput {
  prNumber: number;
  riskScore: number;
  riskThreshold?: number;
  gate: { decision: GateVerdict; reason: string };
  summary?: AggregateSummary;
  findings?: ExploratoryFinding[];
  testTags?: string;
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
  const { prNumber, riskScore, gate, summary, testTags } = input;
  const findings = [...(input.findings ?? [])].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const parts: string[] = [];
  parts.push(`## 🤖 Warden AI QA Report — PR #${prNumber}`);
  parts.push('');

  const bandNote = testTags
    ? ` (${riskBand(riskScore)} — changed: ${testTags})`
    : ` (${riskBand(riskScore)})`;
  parts.push(`**Risk Score:** ${riskScore}/10${bandNote}`);
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
  } else {
    parts.push('### 🐛 Bugs Found (0)');
    parts.push('');
    parts.push('No bugs found by the AI exploratory agent. ✅');
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

/** Title for the Check-Run output block. */
export function checkTitle(gate: GateVerdict, summary?: AggregateSummary): string {
  if (summary && summary.failed > 0) {
    return `Warden QA: ${gate} — ${summary.failed} failing of ${summary.total}`;
  }
  return `Warden QA: ${gate}`;
}
