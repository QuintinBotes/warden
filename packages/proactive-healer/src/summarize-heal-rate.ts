import type { HealRateSummary, LocatorResolution, ProactiveHealSuggestion } from '@warden/core';
import { isUnifiedDiff } from './patch-utils.js';

/**
 * Pure aggregation of a proactive-heal run into a {@link HealRateSummary}. No I/O.
 *
 * `healRate = resolved / checked`, defined as `1` when `checked === 0` (nothing to heal is a
 * healthy state, not a failure). `suggested` counts only suggestions whose `patch` parsed
 * cleanly as a unified diff — a below-confidence or unparseable suggestion is not claimed as a
 * repair.
 */
export function summarizeHealRate(
  resolutions: LocatorResolution[],
  suggestions: ProactiveHealSuggestion[],
): HealRateSummary {
  const checked = resolutions.length;
  let resolved = 0;
  let missing = 0;
  let ambiguous = 0;
  for (const r of resolutions) {
    if (r.status === 'resolved') resolved++;
    else if (r.status === 'missing') missing++;
    else ambiguous++;
  }
  const suggested = suggestions.filter((s) => isUnifiedDiff(s.patch)).length;
  const healRate = checked === 0 ? 1 : resolved / checked;
  return { checked, resolved, missing, ambiguous, suggested, healRate };
}
