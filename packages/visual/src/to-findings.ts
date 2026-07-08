import type { VisualComparison, VisualFinding } from '@warden/core';

/** `changedRatio` at or above this is a HIGH-severity regression. */
const HIGH_RATIO = 0.1;
/** `changedRatio` at or above this (but below {@link HIGH_RATIO}) is MEDIUM. */
const MEDIUM_RATIO = 0.02;

/**
 * Maps comparisons to the `VisualFinding[]` surfaced in the PR comment + dashboard.
 *
 * Only `VISUAL_DIFF` comparisons are regressions and become findings; `MATCH` and `NEW_BASELINE`
 * do not. Severity is derived from `changedRatio` (HIGH ≥ 0.1, MEDIUM ≥ 0.02, else LOW), and the
 * judge's rationale (AI mode) rides along for the reviewer.
 */
export function visualToFindings(comparisons: VisualComparison[]): VisualFinding[] {
  const findings: VisualFinding[] = [];
  for (const comparison of comparisons) {
    if (comparison.status !== 'VISUAL_DIFF') continue;
    findings.push({
      module: comparison.check.module,
      viewport: comparison.check.viewport.name,
      theme: comparison.check.theme,
      severity: severityFor(comparison.changedRatio),
      changedRatio: comparison.changedRatio,
      ...(comparison.judgment?.rationale && { rationale: comparison.judgment.rationale }),
      ...(comparison.baselinePath && { baselinePath: comparison.baselinePath }),
      candidatePath: comparison.candidatePath,
      ...(comparison.diffPath && { diffPath: comparison.diffPath }),
    });
  }
  return findings;
}

/** Severity from the changed-pixel ratio. */
export function severityFor(changedRatio: number): VisualFinding['severity'] {
  if (changedRatio >= HIGH_RATIO) return 'HIGH';
  if (changedRatio >= MEDIUM_RATIO) return 'MEDIUM';
  return 'LOW';
}
