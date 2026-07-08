import type { VisualFinding } from '@warden/core';

const SEVERITY_EMOJI: Record<VisualFinding['severity'], string> = {
  HIGH: '🔴',
  MEDIUM: '🟠',
  LOW: '🟡',
};

/** Escapes pipe/newline characters so arbitrary text is safe inside a Markdown table cell. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Renders `changedRatio` (0..1) as a percentage with two decimals. */
function formatRatio(changedRatio: number): string {
  return `${(changedRatio * 100).toFixed(2)}%`;
}

/** Builds the `baseline · candidate · diff` triptych of Markdown links for a finding. */
function triptychLinks(finding: VisualFinding): string {
  const links: string[] = [];
  if (finding.baselinePath) links.push(`[baseline](${finding.baselinePath})`);
  links.push(`[candidate](${finding.candidatePath})`);
  if (finding.diffPath) links.push(`[diff](${finding.diffPath})`);
  return links.join(' · ');
}

/**
 * Renders the per-check visual-regression table: one row per {@link VisualFinding} with its
 * severity, module/viewport/theme, changed-pixel percentage, the judge rationale (AI mode), and the
 * baseline / candidate / diff triptych links for replay.
 */
export function renderVisualFindingsTable(findings: VisualFinding[]): string {
  const lines: string[] = [];
  lines.push('| Severity | Module | Viewport | Theme | Changed | Notes | Triptych |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const finding of findings) {
    lines.push(
      `| ${SEVERITY_EMOJI[finding.severity]} ${finding.severity} | ${escapeCell(finding.module)} | ` +
        `${escapeCell(finding.viewport)} | ${finding.theme} | ${formatRatio(finding.changedRatio)} | ` +
        `${escapeCell(finding.rationale ?? '—')} | ${escapeCell(triptychLinks(finding))} |`,
    );
  }
  return lines.join('\n');
}

/**
 * Renders the full **Visual Regression** section (heading + table, or an empty-state line) for the
 * PR comment. Reused by {@link renderPrReport} and postable on its own as a standalone comment.
 */
export function renderVisualRegressionSection(findings: VisualFinding[]): string {
  const lines: string[] = ['## Visual Regression', ''];
  if (findings.length === 0) {
    lines.push('_No visual regressions._');
  } else {
    lines.push(renderVisualFindingsTable(findings));
  }
  return lines.join('\n');
}
