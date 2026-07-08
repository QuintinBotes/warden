import type {
  Logger,
  VisualBaselineKey,
  VisualBaselineStore,
  VisualCheck,
  VisualComparison,
  VisualEngine,
  VisualJudge,
  WardenConfig,
} from '@warden/core';
import { pixelDiff } from './pixel-diff.js';

/**
 * Injectable sink for replay media. The pipeline writes the candidate (and diff) PNG through this
 * and records the returned path on the `VisualComparison` — kept behind a seam so tests need no fs.
 */
export interface VisualArtifactSink {
  /** Persist `bytes` under `relPath`; returns the path recorded on the comparison. */
  write(relPath: string, bytes: Uint8Array): Promise<string>;
}

/** Everything {@link compareCheck} needs, every collaborator injected. */
export interface CompareCheckInput {
  check: VisualCheck;
  engine: VisualEngine;
  store: VisualBaselineStore;
  cfg: WardenConfig;
  sourceSha: string;
  artifacts: VisualArtifactSink;
  /** Present only in AI mode; when it errors, the deterministic pixel verdict stands. */
  judge?: VisualJudge;
  logger?: Logger;
}

/** Derives the baseline key for a check (viewport collapses to its name). */
export function keyOf(check: VisualCheck): VisualBaselineKey {
  return { module: check.module, viewport: check.viewport.name, theme: check.theme };
}

/** File-safe slug for a baseline key, used to name replay artifacts. */
export function keySlug(key: VisualBaselineKey): string {
  const clean = (s: string): string => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${clean(key.module)}__${clean(key.viewport)}__${key.theme}`;
}

/**
 * Compares one check against its committed baseline.
 *
 * capture → (no baseline ⇒ `putPending` + `NEW_BASELINE`) → pixel-diff → (`≤ noiseThreshold` ⇒
 * `MATCH`) → in AI mode, judge the pixel-confirmed change (`render-noise` ⇒ downgrade to `MATCH`,
 * `meaningful` ⇒ `VISUAL_DIFF`); in pixel mode any change above the floor is `VISUAL_DIFF`. The
 * candidate PNG is always written for replay; the diff PNG is written whenever pixels were compared.
 */
export async function compareCheck(input: CompareCheckInput): Promise<VisualComparison> {
  const { check, engine, store, cfg, artifacts } = input;
  const key = keyOf(check);
  const slug = keySlug(key);

  const shot = await engine.capture(check);
  const candidatePath = await artifacts.write(`${slug}-candidate.png`, shot.png);

  const baseline = await store.get(key);
  if (!baseline) {
    await store.putPending(key, shot, input.sourceSha);
    return { check, status: 'NEW_BASELINE', changedRatio: 0, candidatePath };
  }

  const baselineBytes = await store.read(baseline);
  const pixel = pixelDiff(baselineBytes, shot.png, cfg);
  const diffPath = await artifacts.write(`${slug}-diff.png`, pixel.diffPng);

  const base: VisualComparison = {
    check,
    status: 'MATCH',
    changedRatio: pixel.changedRatio,
    baselinePath: baseline.path,
    candidatePath,
    diffPath,
  };

  if (pixel.changedRatio <= cfg.visual.noiseThreshold) {
    return base;
  }

  if (cfg.visual.mode === 'ai' && input.judge) {
    try {
      const judgment = await input.judge.judge({
        check,
        baseline: baselineBytes,
        candidate: shot.png,
        pixel,
      });
      if (judgment.classification === 'render-noise') {
        input.logger?.info('visual: render-noise suppressed', {
          module: check.module,
          rationale: judgment.rationale,
        });
        return { ...base, status: 'MATCH', judgment };
      }
      return { ...base, status: 'VISUAL_DIFF', judgment };
    } catch (err) {
      input.logger?.warn('visual: AI judge failed, falling back to pixel verdict', {
        module: check.module,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ...base, status: 'VISUAL_DIFF' };
    }
  }

  return { ...base, status: 'VISUAL_DIFF' };
}
