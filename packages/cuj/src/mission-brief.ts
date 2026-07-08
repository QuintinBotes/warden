import type { Cuj } from '@warden/core';

/** Hard cap on the rendered brief so it can be safely prepended to an agent prompt. */
export const MISSION_BRIEF_MAX_CHARS = 4000;

/**
 * Renders a journey as the exploratory agent's mission-brief prompt block: the ordered steps,
 * the SLO-style thresholds, and the owning team. Bounded in size so it can never blow the
 * prompt budget.
 */
export function renderCujMissionBrief(cuj: Cuj): string {
  const lines: string[] = [
    `## Mission brief: ${cuj.name} (${cuj.tier})`,
    `Owning team: ${cuj.owningTeam}`,
  ];
  if (cuj.description) lines.push(cuj.description);
  lines.push('', 'Walk this critical user journey in order and try to break each step:');

  const steps = cuj.steps.slice().sort((a, b) => a.order - b.order);
  if (steps.length === 0) {
    lines.push('(no steps declared)');
  } else {
    for (const step of steps) {
      const suffix = step.module ? ` [${step.module}]` : '';
      lines.push(`${step.order}. ${step.name}${suffix}`);
    }
  }

  const t = cuj.thresholds;
  const thresholds: string[] = [`min pass rate ${t.minPassRatePercent}%`];
  if (t.maxP95LatencyMs !== undefined) thresholds.push(`p95 latency <= ${t.maxP95LatencyMs}ms`);
  if (t.requireA11y) thresholds.push('accessibility required');
  if (t.maxVisualDiffRatio !== undefined) {
    thresholds.push(`visual diff <= ${t.maxVisualDiffRatio}`);
  }
  lines.push('', `Thresholds: ${thresholds.join('; ')}.`);

  const rendered = lines.join('\n');
  return rendered.length > MISSION_BRIEF_MAX_CHARS
    ? rendered.slice(0, MISSION_BRIEF_MAX_CHARS).trimEnd()
    : rendered;
}
