import type { ChangeSurface, TestTier, WardenConfig } from '@warden/core';

/**
 * Choose which test tiers to run for a change surface. Low-risk diffs get a fast
 * smoke + selective pass; anything riskier escalates to full regression plus the AI
 * exploratory tier. Any change that touches shared/infra code always forces full
 * regression, regardless of score. A change that touches API routes adds the `api`
 * tier (Schemathesis fuzzing + Pact contract verification) when `config.api` is enabled.
 */
export function selectTiers(surface: ChangeSurface, cfg: WardenConfig): TestTier[] {
  const tiers: TestTier[] =
    surface.riskScore <= 3 ? ['smoke', 'selective'] : ['smoke', 'fullRegression', 'aiExploratory'];

  if (surface.hasSharedChanges && !tiers.includes('fullRegression')) {
    tiers.push('fullRegression');
  }

  if (cfg.api.enabled && surface.affectedApiRoutes.length > 0 && !tiers.includes('api')) {
    tiers.push('api');
  }

  return tiers;
}
