import type { ChangeSurface, WardenConfig } from '@warden/core';

/**
 * Pure gate for the proactive-healing pass.
 *
 * Returns `true` only when `proactiveHealing.enabled` AND the change surface shows a UI
 * change — either a non-empty `affectedComponents`, or a changed module/file that matches one
 * of the configured `uiPatterns`. Never launches anything; a `true` result only means the
 * caller *may* run `runProactiveHeal`. Disabled config always returns `false`, so a zero-config
 * repo gets exactly today's behavior (only the reactive `HealerStrategy` runs).
 */
export function shouldRunProactiveHeal(surface: ChangeSurface, cfg: WardenConfig): boolean {
  if (!cfg.proactiveHealing.enabled) return false;
  if (surface.affectedComponents.length > 0) return true;

  const patterns = cfg.proactiveHealing.uiPatterns;
  if (patterns.length === 0) return false;

  const candidates = [...surface.changedModules, ...surface.changedFiles];
  return candidates.some((path) => patterns.some((pattern) => path.includes(pattern)));
}
