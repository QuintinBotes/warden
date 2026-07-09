import type { ChangeSurface, CoverageIndex, ImpactResult, WardenConfig } from '@warden/core';
import { computeImpact } from './compute-impact.js';

/**
 * Render an {@link ImpactResult}'s impacted test names into a Playwright `--grep` value: a regex
 * alternation of the (regex-escaped) names, e.g. `guest checkout|add to cart`. Returns `''` when
 * nothing is impacted (no narrowing to express).
 */
export function impactToGrep(result: ImpactResult): string {
  if (result.impacted.length === 0) return '';
  return result.impacted.map((t) => escapeRegExp(t.testName)).join('|');
}

/** The selection the CLI/orchestrator acts on: a narrowed grep, a full-suite run, or defer. */
export interface ImpactSelection {
  /** A Playwright `--grep` to narrow to, or `null` when no impact narrowing applies. */
  grep: string | null;
  /** True when the run must not be narrowed (the `run-all` safety net forces the full suite). */
  runAll: boolean;
  /** The underlying result, so the caller can still read `safetyNet` / `uncoveredChangedFiles`. */
  result: ImpactResult;
}

/**
 * Compose {@link computeImpact} + {@link impactToGrep} into the decision the CLI calls — mirroring
 * how the CUJ / quality-audit engines are wired at the bin layer (the orchestrator owns the wiring;
 * this package stays pure).
 *
 * Precedence:
 *  1. An uncovered changed file under `onUncovered: 'run-all'` forces the full suite
 *     (`runAll: true`, `grep: null`) — a brand-new file is never silently skipped.
 *  2. Otherwise, when tests are impacted, narrow to them (`grep`, `runAll: false`).
 *  3. Otherwise defer to the caller's existing tier selection (`grep: null`, `runAll: false`).
 *     The `result` still carries `safetyNet`/`uncoveredChangedFiles` so a `run-tagged` policy can
 *     union its tag selection on top.
 */
export function selectWithImpact(
  changeSurface: ChangeSurface,
  index: CoverageIndex,
  cfg: WardenConfig,
): ImpactSelection {
  const result = computeImpact(changeSurface, index, cfg);

  if (result.safetyNet && cfg.impact.onUncovered === 'run-all') {
    return { grep: null, runAll: true, result };
  }
  if (result.impacted.length > 0) {
    return { grep: impactToGrep(result), runAll: false, result };
  }
  return { grep: null, runAll: false, result };
}

/** Escape a literal string for safe embedding in a regex alternation. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
