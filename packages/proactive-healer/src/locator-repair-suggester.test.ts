import { describe, expect, it } from 'vitest';
import type { LocatorRef, LocatorResolution } from '@warden/core';
import { suggestRepairs } from './locator-repair-suggester.js';
import { isUnifiedDiff } from './patch-utils.js';
import { fakeLocatingSession, scriptedProvider } from './testing-fakes.js';

const buy: LocatorRef = {
  filePath: 'checkout.spec.ts',
  line: 4,
  kind: 'click',
  role: 'button',
  name: 'Buy',
};
const email: LocatorRef = {
  filePath: 'checkout.spec.ts',
  line: 5,
  kind: 'fill',
  role: 'label',
  name: 'Email',
};

function missing(locator: LocatorRef): LocatorResolution {
  return { locator, status: 'missing', matchCount: 0 };
}
function resolved(locator: LocatorRef): LocatorResolution {
  return { locator, status: 'resolved', matchCount: 1 };
}

describe('suggestRepairs', () => {
  it('turns a propose_locator tool call into a suggestion with a well-formed unified-diff patch', async () => {
    const session = fakeLocatingSession();
    const provider = scriptedProvider([
      {
        toolCalls: [
          {
            name: 'propose_locator',
            input: {
              suggestedName: 'Purchase',
              confidence: 'high',
              reason: 'Buy was renamed to Purchase',
            },
          },
        ],
      },
    ]);

    const [s] = await suggestRepairs([missing(buy)], session, provider, {
      minConfidence: 'medium',
    });

    expect(s!.suggestedName).toBe('Purchase');
    expect(s!.confidence).toBe('high');
    expect(s!.reason).toBe('Buy was renamed to Purchase');
    expect(isUnifiedDiff(s!.patch)).toBe(true);
    expect(s!.patch).toContain("-  getByRole('button', { name: 'Buy' })");
    expect(s!.patch).toContain("+  getByRole('button', { name: 'Purchase' })");
  });

  it('builds a getByLabel patch for a fill locator', async () => {
    const session = fakeLocatingSession();
    const provider = scriptedProvider([
      {
        toolCalls: [
          {
            name: 'propose_locator',
            input: { suggestedName: 'Email address', confidence: 'high' },
          },
        ],
      },
    ]);

    const [s] = await suggestRepairs([missing(email)], session, provider, {
      minConfidence: 'medium',
    });

    expect(s!.patch).toContain("-  getByLabel('Email')");
    expect(s!.patch).toContain("+  getByLabel('Email address')");
  });

  it('falls back to confidence low with no patch when the model returns no tool call', async () => {
    const session = fakeLocatingSession();
    const provider = scriptedProvider([{ text: 'not sure' }]);

    const [s] = await suggestRepairs([missing(buy)], session, provider);

    expect(s!.confidence).toBe('low');
    expect(s!.patch).toBe('');
    expect(s!.suggestedName).toBe('Buy');
    expect(s!.reason).toMatch(/no structured proposal/);
  });

  it('omits the patch (left for the reactive healer) when confidence is below minConfidence', async () => {
    const session = fakeLocatingSession();
    const provider = scriptedProvider([
      {
        toolCalls: [
          { name: 'propose_locator', input: { suggestedName: 'Purchase', confidence: 'medium' } },
        ],
      },
    ]);

    const [s] = await suggestRepairs([missing(buy)], session, provider, { minConfidence: 'high' });

    expect(s!.confidence).toBe('medium');
    expect(s!.suggestedName).toBe('Purchase');
    expect(s!.patch).toBe('');
    expect(s!.reason).toMatch(/below the high bar/);
  });

  it('skips resolved locators and only asks the provider about the broken ones', async () => {
    const session = fakeLocatingSession();
    const provider = scriptedProvider([
      {
        toolCalls: [
          { name: 'propose_locator', input: { suggestedName: 'Purchase', confidence: 'high' } },
        ],
      },
    ]);

    const suggestions = await suggestRepairs([resolved(email), missing(buy)], session, provider);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.locator).toBe(buy);
    expect(provider.calls).toHaveLength(1);
  });
});
