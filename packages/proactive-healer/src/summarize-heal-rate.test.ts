import { describe, expect, it } from 'vitest';
import type {
  LocatorRef,
  LocatorResolution,
  LocatorStatus,
  ProactiveHealSuggestion,
} from '@warden/core';

import { summarizeHealRate } from './summarize-heal-rate.js';

const loc: LocatorRef = {
  filePath: 'a.spec.ts',
  line: 1,
  kind: 'click',
  role: 'button',
  name: 'X',
};

function res(status: LocatorStatus): LocatorResolution {
  return {
    locator: loc,
    status,
    matchCount: status === 'resolved' ? 1 : status === 'missing' ? 0 : 2,
  };
}

const validPatch = ['--- a/a.spec.ts', '+++ b/a.spec.ts', '@@ -1,1 +1,1 @@', '-a', '+b'].join('\n');

function sug(patch: string): ProactiveHealSuggestion {
  return { locator: loc, suggestedName: 'Y', confidence: 'high', patch, reason: 'r' };
}

describe('summarizeHealRate', () => {
  it('returns healRate 1 for the empty (checked === 0) case', () => {
    expect(summarizeHealRate([], [])).toEqual({
      checked: 0,
      resolved: 0,
      missing: 0,
      ambiguous: 0,
      suggested: 0,
      healRate: 1,
    });
  });

  it('is 1 when everything resolves', () => {
    const summary = summarizeHealRate([res('resolved'), res('resolved')], []);
    expect(summary.healRate).toBe(1);
    expect(summary.resolved).toBe(2);
  });

  it('counts statuses and only patches that parse cleanly, and computes resolved/checked', () => {
    const resolutions = [res('resolved'), res('resolved'), res('missing'), res('ambiguous')];
    const suggestions = [sug(validPatch), sug(validPatch), sug('')];

    expect(summarizeHealRate(resolutions, suggestions)).toEqual({
      checked: 4,
      resolved: 2,
      missing: 1,
      ambiguous: 1,
      suggested: 2,
      healRate: 0.5,
    });
  });
});
