import { describe, it, expect } from 'vitest';
import { MISSION_BRIEF_MAX_CHARS, renderCujMissionBrief } from './mission-brief.js';
import { fixtureCuj } from './testing-fakes.js';

describe('renderCujMissionBrief', () => {
  it('renders every step in order, the owning team, and the thresholds', () => {
    const cuj = fixtureCuj({
      name: 'Guest checkout',
      owningTeam: 'payments',
      thresholds: { minPassRatePercent: 100, maxP95LatencyMs: 800, requireA11y: true },
      steps: [
        { order: 2, name: 'Pay', module: '@apps/checkout', testIds: [] },
        { order: 1, name: 'Add item to cart', module: '@apps/cart', testIds: [] },
      ],
    });

    const brief = renderCujMissionBrief(cuj);

    expect(brief).toContain('Guest checkout');
    expect(brief).toContain('payments');
    // ordered
    expect(brief.indexOf('Add item to cart')).toBeLessThan(brief.indexOf('Pay'));
    expect(brief).toContain('p95 latency <= 800ms');
    expect(brief).toContain('accessibility required');
  });

  it('is bounded under the documented size cap', () => {
    const steps = Array.from({ length: 500 }, (_, i) => ({
      order: i,
      name: `step number ${i} with a fairly long descriptive name to inflate the brief`,
      module: `@m/${i}`,
      testIds: [],
    }));
    const brief = renderCujMissionBrief(fixtureCuj({ steps }));
    expect(brief.length).toBeLessThanOrEqual(MISSION_BRIEF_MAX_CHARS);
  });

  it('handles a journey with no steps', () => {
    const brief = renderCujMissionBrief(fixtureCuj({ steps: [] }));
    expect(brief).toContain('(no steps declared)');
  });
});
