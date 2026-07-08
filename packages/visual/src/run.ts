import {
  CTRFReportSchema,
  type CTRFReport,
  type ChangeSurface,
  type LLMProvider,
  type Logger,
  type VisualBaselineStore,
  type VisualComparison,
  type VisualEngine,
  type VisualFinding,
  type VisualJudge,
  type WardenConfig,
} from '@warden/core';
import { planVisualChecks, plannedMatrixSize } from './plan-checks.js';
import { compareCheck, type VisualArtifactSink } from './compare.js';
import { ProviderVisualJudge } from './provider-visual-judge.js';
import { visualToCtrf, VISUAL_TOOL_NAME } from './to-ctrf.js';
import { visualToFindings } from './to-findings.js';

/** Everything {@link runVisualChecks} needs — every external collaborator injected for hermeticity. */
export interface RunVisualChecksInput {
  changeSurface: ChangeSurface;
  cfg: WardenConfig;
  /** Resolves a module to its live preview URL. */
  resolveUrl: (module: string) => string;
  /** The deterministic screenshot engine (a fake in tests, {@link createVisualEngine} in prod). */
  engine: VisualEngine;
  store: VisualBaselineStore;
  /** Commit the candidate baselines were captured from. */
  sourceSha: string;
  /** Replay-media sink for candidate/diff PNGs. */
  artifacts: VisualArtifactSink;
  /** Provider used to build the AI judge in `mode: 'ai'`; ignored in pixel mode. */
  provider?: LLMProvider;
  /** Explicit judge override; when omitted in AI mode one is built from `provider`. */
  judge?: VisualJudge;
  logger?: Logger;
}

/** The outcome of a visual run: comparisons, the CTRF the gate consumes, and PR-comment findings. */
export interface RunVisualResult {
  comparisons: VisualComparison[];
  ctrf: CTRFReport;
  findings: VisualFinding[];
  /** Checks dropped because the matrix exceeded `visual.maxChecks` (never silently truncated). */
  skipped: number;
}

/**
 * The visual-regression pipeline: plan → capture → compare → convert.
 *
 * No-ops at zero cost when `visual.enabled` is false or the change surface touches nothing. In
 * `mode: 'ai'` it builds a {@link ProviderVisualJudge} from the provider when that provider exposes
 * `generateWithImages`, otherwise it logs and falls back to the deterministic pixel floor. Returns
 * the comparisons plus the `warden-visual` CTRF and the `VisualFinding[]`.
 */
export async function runVisualChecks(input: RunVisualChecksInput): Promise<RunVisualResult> {
  const { cfg } = input;

  if (!cfg.visual.enabled) {
    return { comparisons: [], ctrf: emptyCtrf(), findings: [], skipped: 0 };
  }

  const checks = planVisualChecks(input.changeSurface, cfg, input.resolveUrl);
  const skipped = Math.max(0, plannedMatrixSize(input.changeSurface, cfg) - checks.length);

  if (checks.length === 0) {
    return { comparisons: [], ctrf: emptyCtrf(), findings: [], skipped };
  }

  const judge = resolveJudge(input);

  const comparisons: VisualComparison[] = [];
  try {
    for (const check of checks) {
      comparisons.push(
        await compareCheck({
          check,
          engine: input.engine,
          store: input.store,
          cfg,
          sourceSha: input.sourceSha,
          artifacts: input.artifacts,
          ...(judge && { judge }),
          ...(input.logger && { logger: input.logger }),
        }),
      );
    }
  } finally {
    await input.engine.close();
  }

  const ctrf = visualToCtrf(comparisons, cfg);
  const findings = visualToFindings(comparisons);
  return { comparisons, ctrf, findings, skipped };
}

/** Builds the AI judge in `mode: 'ai'`, falling back to pixel-only when no vision is available. */
function resolveJudge(input: RunVisualChecksInput): VisualJudge | undefined {
  if (input.cfg.visual.mode !== 'ai') return undefined;
  if (input.judge) return input.judge;
  if (input.provider?.generateWithImages) return new ProviderVisualJudge(input.provider);
  input.logger?.warn(
    'visual: mode "ai" requested but provider lacks generateWithImages; using pixel floor',
  );
  return undefined;
}

function emptyCtrf(): CTRFReport {
  return CTRFReportSchema.parse({
    results: {
      tool: { name: VISUAL_TOOL_NAME },
      summary: {
        tests: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        pending: 0,
        other: 0,
        start: 0,
        stop: 0,
      },
      tests: [],
    },
  });
}
