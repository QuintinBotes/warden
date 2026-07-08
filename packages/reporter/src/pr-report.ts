import type {
  ExploratoryFinding,
  GateDecision,
  Requirement,
  TestExecution,
  VisualFinding,
} from '@warden/core';
import { renderVisualRegressionSection } from './visual-comment-reporter.js';

/** Extra, optional context {@link renderPrReport} can weave into the Markdown. */
export interface RenderPrReportExtras {
  riskScore?: number;
  findings?: ExploratoryFinding[];
  requirements?: Requirement[];
  /** Visual regressions from `@warden/visual`; when present, a Visual Regression section renders. */
  visualFindings?: VisualFinding[];
}

const GATE_EMOJI: Record<GateDecision['decision'], string> = {
  PASS: '✅',
  WARN: '⚠️',
  BLOCK: '⛔',
};

/** Escapes pipe/newline characters so arbitrary text is safe inside a Markdown table cell. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Renders the blueprint PR-report Markdown: gate decision, risk score, bugs found,
 * a coverage table, and a requirements traceability table.
 */
export function renderPrReport(
  execution: TestExecution,
  gate: GateDecision,
  extras: RenderPrReportExtras = {},
): string {
  const lines: string[] = [];

  lines.push('# Warden QA Report');
  lines.push('');
  lines.push(`## QA Gate: ${GATE_EMOJI[gate.decision]} ${gate.decision}`);
  lines.push('');
  lines.push(`> ${gate.reason}`);
  lines.push('');

  if (extras.riskScore !== undefined) {
    lines.push(`**Risk Score:** ${extras.riskScore}`);
    lines.push('');
  }

  lines.push('## Bugs Found');
  lines.push('');
  const findings = extras.findings ?? [];
  if (findings.length === 0) {
    lines.push('_No bugs found._');
  } else {
    lines.push('| Severity | Title | Expected | Actual |');
    lines.push('| --- | --- | --- | --- |');
    for (const finding of findings) {
      lines.push(
        `| ${finding.severity} | ${escapeCell(finding.title)} | ${escapeCell(finding.expected)} | ${escapeCell(finding.actual)} |`,
      );
    }
  }
  lines.push('');

  if (extras.visualFindings !== undefined) {
    lines.push(renderVisualRegressionSection(extras.visualFindings));
    lines.push('');
  }

  lines.push('## Coverage');
  lines.push('');
  lines.push('| Test | Status | Duration (ms) | Retries |');
  lines.push('| --- | --- | --- | --- |');
  for (const result of execution.results) {
    lines.push(
      `| ${result.testCaseId} | ${result.status} | ${result.duration} | ${result.retries} |`,
    );
  }
  lines.push('');

  lines.push('## Requirements Traceability');
  lines.push('');
  const requirements = extras.requirements ?? [];
  if (requirements.length === 0) {
    lines.push('_No linked requirements._');
  } else {
    lines.push('| Requirement | Title | Coverage |');
    lines.push('| --- | --- | --- |');
    for (const requirement of requirements) {
      lines.push(
        `| ${requirement.id} | ${escapeCell(requirement.title)} | ${requirement.coverageStatus} |`,
      );
    }
  }
  lines.push('');

  return lines.join('\n');
}
