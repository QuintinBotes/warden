import { describe, it, expect } from 'vitest';
import type { TouchedCuj } from '@warden/core';
import { resolveCujBaseline } from './baseline.js';
import { fixtureCuj, fixtureResult, memExecutionHistory } from './testing-fakes.js';

const NOW = new Date('2026-07-09T00:00:00.000Z');

function touched(): TouchedCuj[] {
  return [{ cuj: fixtureCuj(), matchedTags: ['@apps/checkout'], reason: 'touched' }];
}

describe('resolveCujBaseline', () => {
  it('rolls up the base ref last execution into a before-health report per touched CUJ', async () => {
    const history = memExecutionHistory({
      main: [fixtureResult('TC-cart', 'PASS'), fixtureResult('TC-pay', 'PASS')],
    });

    const reports = await resolveCujBaseline(touched(), 'main', history, { now: NOW });

    expect(reports).toHaveLength(1);
    expect(reports[0]!.cujId).toBe('CUJ-checkout');
    expect(reports[0]!.status).toBe('HEALTHY');
  });

  it('yields NOT_TESTED before-health when the base ref has no matching results', async () => {
    const history = memExecutionHistory({}); // nothing recorded on any ref
    const reports = await resolveCujBaseline(touched(), 'main', history, { now: NOW });
    expect(reports[0]!.status).toBe('NOT_TESTED');
  });

  it('only requests the touched CUJ own test ids', async () => {
    const requested: string[][] = [];
    const history = {
      async latestForRef(_ref: string, testIds: string[]) {
        requested.push(testIds);
        return [];
      },
    };
    await resolveCujBaseline(touched(), 'main', history, { now: NOW });
    expect(requested[0]!.sort()).toEqual(['TC-cart', 'TC-pay']);
  });
});
