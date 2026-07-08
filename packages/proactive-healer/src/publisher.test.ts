import { describe, expect, it } from 'vitest';
import type { HealRateSummary, LocatorRef, ProactiveHealSuggestion } from '@warden/core';
import { proactiveHealBranchName, publishProactiveHeal } from './publisher.js';
import { buildLocatorPatch } from './patch-utils.js';
import { fixturePr, recordingGitHub } from './testing-fakes.js';

const pr = fixturePr();

function loc(filePath: string, line: number, name: string): LocatorRef {
  return { filePath, line, kind: 'click', role: 'button', name };
}

function sug(
  locator: LocatorRef,
  suggestedName: string,
  patch = buildLocatorPatch(locator, suggestedName),
): ProactiveHealSuggestion {
  return { locator, suggestedName, confidence: 'high', patch, reason: 'renamed' };
}

const summary: HealRateSummary = {
  checked: 3,
  resolved: 1,
  missing: 2,
  ambiguous: 0,
  suggested: 2,
  healRate: 1 / 3,
};

describe('publishProactiveHeal', () => {
  it('opens one idempotent draft PR of grouped patches and always posts a neutral check', async () => {
    const gh = recordingGitHub();
    const suggestions = [
      sug(loc('checkout.spec.ts', 4, 'Buy'), 'Purchase'),
      sug(loc('checkout.spec.ts', 9, 'Cancel'), 'Dismiss'),
      sug(loc('account.spec.ts', 2, 'Save'), 'Update'),
    ];

    const result = await publishProactiveHeal(suggestions, summary, pr, gh);

    expect(gh.draftPrCalls).toHaveLength(1);
    const draft = gh.draftPrCalls[0]!;
    expect(draft.repo).toBe('org/shop');
    expect(draft.branch).toBe('warden/proactive-heal-pr-42');
    // Grouped per file, sorted; checkout's two patches are concatenated into one entry.
    expect(draft.files.map((f) => f.path)).toEqual(['account.spec.ts', 'checkout.spec.ts']);
    const checkoutEntry = draft.files.find((f) => f.path === 'checkout.spec.ts')!;
    expect(checkoutEntry.content).toContain("name: 'Purchase'");
    expect(checkoutEntry.content).toContain("name: 'Dismiss'");

    expect(gh.checkRunCalls).toHaveLength(1);
    expect(gh.checkRunCalls[0]!.conclusion).toBe('neutral');
    expect(gh.checkRunCalls[0]!.summary).toContain('optional posture');

    expect(result.draftPr).toEqual({ url: 'https://github.com/org/shop/pull/101', number: 101 });
    expect(result.suggested).toBe(3);
  });

  it('opens no PR but still posts a neutral check when there is nothing confident to heal', async () => {
    const gh = recordingGitHub();
    const suggestions = [sug(loc('checkout.spec.ts', 4, 'Buy'), 'Purchase', '')]; // empty patch

    const result = await publishProactiveHeal(suggestions, summary, pr, gh);

    expect(gh.draftPrCalls).toHaveLength(0);
    expect(gh.checkRunCalls).toHaveLength(1);
    expect(gh.checkRunCalls[0]!.conclusion).toBe('neutral');
    expect(result.draftPr).toBeUndefined();
    expect(result.suggested).toBe(0);
  });

  it('reuses the same branch on a second run for the same PR (idempotent, no duplicate branch)', async () => {
    const gh = recordingGitHub();
    const suggestions = [sug(loc('checkout.spec.ts', 4, 'Buy'), 'Purchase')];

    await publishProactiveHeal(suggestions, summary, pr, gh);
    await publishProactiveHeal(suggestions, summary, pr, gh);

    expect(gh.draftPrCalls).toHaveLength(2);
    expect(gh.draftPrCalls.map((c) => c.branch)).toEqual([
      'warden/proactive-heal-pr-42',
      'warden/proactive-heal-pr-42',
    ]);
  });

  it('has a stable branch name derived only from the PR number', () => {
    expect(proactiveHealBranchName(pr)).toBe('warden/proactive-heal-pr-42');
    expect(proactiveHealBranchName(fixturePr({ number: 7 }))).toBe('warden/proactive-heal-pr-7');
  });
});
