import {
  CTRFReportSchema,
  type CTRFReport,
  type CTRFTest,
  type VisualComparison,
  type WardenConfig,
} from '@warden/core';
import { keyOf, keySlug } from './compare.js';

/** The CTRF `tool.name` all visual reports carry, so the merge gate recognises the tier. */
export const VISUAL_TOOL_NAME = 'warden-visual';

/**
 * Converts visual comparisons into a `warden-visual` CTRF report that the existing merge gate
 * consumes unchanged.
 *
 * `MATCH` → `passed`. `NEW_BASELINE` → `failed` when `visual.onNewBaseline: 'block'`, else
 * `passed`. `VISUAL_DIFF` → `failed` when `visual.gate: 'block'`, a warn-tagged `other` when
 * `'warn'`, and `passed` when `'off'`. Baseline/candidate/diff paths ride in each test's `extra`
 * so the dashboard can replay the triptych straight off the CTRF.
 */
export function visualToCtrf(comparisons: VisualComparison[], cfg: WardenConfig): CTRFReport {
  const tests: CTRFTest[] = comparisons.map((comparison) => toTest(comparison, cfg));

  const summary = tests.reduce(
    (acc, test) => {
      acc.tests += 1;
      acc[test.status] += 1;
      return acc;
    },
    { tests: 0, passed: 0, failed: 0, skipped: 0, pending: 0, other: 0 },
  );

  return CTRFReportSchema.parse({
    results: {
      tool: { name: VISUAL_TOOL_NAME },
      summary: { ...summary, start: 0, stop: 0 },
      tests,
    },
  });
}

function toTest(comparison: VisualComparison, cfg: WardenConfig): CTRFTest {
  const key = keyOf(comparison.check);
  const { status: ctrfStatus, tags } = mapStatus(comparison, cfg);

  const extra: Record<string, unknown> = {
    module: comparison.check.module,
    viewport: comparison.check.viewport.name,
    theme: comparison.check.theme,
    visualStatus: comparison.status,
    changedRatio: comparison.changedRatio,
    candidatePath: comparison.candidatePath,
  };
  if (comparison.baselinePath) extra.baselinePath = comparison.baselinePath;
  if (comparison.diffPath) extra.diffPath = comparison.diffPath;
  if (comparison.judgment) {
    extra.classification = comparison.judgment.classification;
    extra.confidence = comparison.judgment.confidence;
    extra.rationale = comparison.judgment.rationale;
  }

  return {
    name: keySlug(key),
    status: ctrfStatus,
    duration: 0,
    ...(comparison.judgment?.rationale && { message: comparison.judgment.rationale }),
    ...(tags.length > 0 && { tags }),
    extra,
  };
}

function mapStatus(
  comparison: VisualComparison,
  cfg: WardenConfig,
): { status: CTRFTest['status']; tags: string[] } {
  switch (comparison.status) {
    case 'MATCH':
      return { status: 'passed', tags: [] };
    case 'NEW_BASELINE':
      return cfg.visual.onNewBaseline === 'block'
        ? { status: 'failed', tags: ['new-baseline'] }
        : { status: 'passed', tags: ['new-baseline'] };
    case 'VISUAL_DIFF':
      if (cfg.visual.gate === 'block') return { status: 'failed', tags: ['visual-diff'] };
      if (cfg.visual.gate === 'warn') return { status: 'other', tags: ['visual-diff', 'warn'] };
      return { status: 'passed', tags: ['visual-diff'] };
  }
}
