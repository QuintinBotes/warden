import type { ChangeSurface, StrategyName, WardenConfig } from '@warden/core';

/**
 * Decide which AI agent strategies to dispatch for a change surface, and whether the risk
 * is high enough that a human should be pulled in. Thresholds come from config so teams can
 * tune how eagerly the exploratory tier fires.
 */
export function dispatchAgents(
  surface: ChangeSurface,
  cfg: WardenConfig,
): { strategies: StrategyName[]; notifyHuman: boolean } {
  const strategies: StrategyName[] = [];

  if (surface.riskScore >= cfg.tiers.aiExploratory.riskThreshold) {
    strategies.push('exploratory');
  }
  if (surface.riskScore > 5) {
    strategies.push('generative');
  }

  return { strategies, notifyHuman: surface.riskScore >= 7 };
}
