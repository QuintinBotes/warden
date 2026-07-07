import type { ChangeSurface, TestTier, WardenConfig } from '@warden/core';

/**
 * Choose which test tiers to run for a change surface. Low-risk diffs get a fast
 * smoke + selective pass; anything riskier escalates to full regression plus the AI
 * exploratory tier. Any change that touches shared/infra code always forces full
 * regression, regardless of score.
 */
export function selectTiers(surface: ChangeSurface, cfg: WardenConfig): TestTier[] {
  void cfg;

  const tiers: TestTier[] =
    surface.riskScore <= 3 ? ['smoke', 'selective'] : ['smoke', 'fullRegression', 'aiExploratory'];

  if (surface.hasSharedChanges && !tiers.includes('fullRegression')) {
    tiers.push('fullRegression');
  }

  return tiers;
}
