import { describe, expect, it } from 'vitest';
import type { HealRateSummary, LocatorRef, ProactiveHealSuggestion } from '@warden/core';
import { proactiveHealBranchName, publishProactiveHeal } from './publisher.js';
import { buildLocatorPatch } from './patch-utils.js';
import { fixturePr, memFileAccess, recordingGitHub } from './testing-fakes.js';

const pr = fixturePr();

/** A real spec file, so a patch published against it can be checked for actually applying. */
function specFile(...names: string[]): string {
  return [
    "import { test, expect } from '@playwright/test';",
    '',
    "test('flow', async ({ page }) => {",
    ...names.map((name) => `  await page.getByRole('button', { name: '${name}' }).click();`),
    "  await expect(page).toHaveURL('/done');",
    '});',
    '',
  ].join('\n');
}

/** The locator ref the extractor would produce for `name` in a {@link specFile}. */
function loc(filePath: string, line: number, name: string): LocatorRef {
  return {
    filePath,
    line,
    kind: 'click',
    role: 'button',
    name,
    sourceLine: `  await page.getByRole('button', { name: '${name}' }).click();`,
  };
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
  it('commits the file with the patch applied — never the diff text over the file', async () => {
    const gh = recordingGitHub();
    const before = specFile('Buy');
    const files = memFileAccess({ 'tests/e2e/checkout.spec.ts': before });
    const suggestions = [sug(loc('tests/e2e/checkout.spec.ts', 4, 'Buy'), 'Purchase')];

    const result = await publishProactiveHeal(suggestions, summary, pr, gh, files);

    const entry = gh.draftPrCalls[0]!.files[0]!;
    expect(entry.path).toBe('tests/e2e/checkout.spec.ts');
    // The whole file survives: only the locator's name changed.
    expect(entry.content).toBe(before.replace("name: 'Buy'", "name: 'Purchase'"));
    expect(entry.content).toContain("import { test, expect } from '@playwright/test';");
    expect(entry.content).toContain("await expect(page).toHaveURL('/done');");
    // The diff markers are what the old publisher wrote as the file body.
    expect(entry.content).not.toContain('@@');
    expect(entry.content).not.toContain('--- a/');
    expect(result.unapplied).toEqual([]);
    expect(result.suggested).toBe(1);
  });

  it('opens one idempotent draft PR of per-file contents and always posts a neutral check', async () => {
    const gh = recordingGitHub();
    const files = memFileAccess({
      'checkout.spec.ts': specFile('Buy', 'Cancel'),
      'account.spec.ts': specFile('Save'),
    });
    const suggestions = [
      sug(loc('checkout.spec.ts', 4, 'Buy'), 'Purchase'),
      sug(loc('checkout.spec.ts', 5, 'Cancel'), 'Dismiss'),
      sug(loc('account.spec.ts', 4, 'Save'), 'Update'),
    ];

    const result = await publishProactiveHeal(suggestions, summary, pr, gh, files);

    expect(gh.draftPrCalls).toHaveLength(1);
    const draft = gh.draftPrCalls[0]!;
    expect(draft.repo).toBe('org/shop');
    expect(draft.branch).toBe('warden/proactive-heal-pr-42');
    // Grouped per file, sorted; checkout's two edits land in one entry.
    expect(draft.files.map((f) => f.path)).toEqual(['account.spec.ts', 'checkout.spec.ts']);
    const checkoutEntry = draft.files.find((f) => f.path === 'checkout.spec.ts')!;
    expect(checkoutEntry.content).toContain("name: 'Purchase'");
    expect(checkoutEntry.content).toContain("name: 'Dismiss'");
    expect(checkoutEntry.content).not.toContain("name: 'Buy'");

    expect(gh.checkRunCalls).toHaveLength(1);
    expect(gh.checkRunCalls[0]!.conclusion).toBe('neutral');
    expect(gh.checkRunCalls[0]!.summary).toContain('optional posture');

    expect(result.draftPr).toEqual({ url: 'https://github.com/org/shop/pull/101', number: 101 });
    expect(result.suggested).toBe(3);
  });

  it('does not commit a patch that no longer matches the file, and says so on the check', async () => {
    const gh = recordingGitHub();
    const moved = loc('checkout.spec.ts', 4, 'Buy');
    const files = memFileAccess({ 'checkout.spec.ts': specFile('Checkout') }); // 'Buy' is gone

    const result = await publishProactiveHeal([sug(moved, 'Purchase')], summary, pr, gh, files);

    expect(gh.draftPrCalls).toHaveLength(0);
    expect(result.suggested).toBe(0);
    expect(result.unapplied).toHaveLength(1);
    expect(result.unapplied[0]!.path).toBe('checkout.spec.ts');
    expect(gh.checkRunCalls[0]!.summary).toContain('not published: checkout.spec.ts:4');
    expect(gh.checkRunCalls[0]!.conclusion).toBe('neutral');
  });

  it('publishes the files it could patch and reports the one it could not read', async () => {
    const gh = recordingGitHub();
    const files = memFileAccess({ 'account.spec.ts': specFile('Save') });
    const suggestions = [
      sug(loc('account.spec.ts', 4, 'Save'), 'Update'),
      sug(loc('deleted.spec.ts', 4, 'Buy'), 'Purchase'),
    ];

    const result = await publishProactiveHeal(suggestions, summary, pr, gh, files);

    expect(gh.draftPrCalls[0]!.files.map((f) => f.path)).toEqual(['account.spec.ts']);
    expect(result.suggested).toBe(1);
    expect(result.unapplied).toEqual([
      { path: 'deleted.spec.ts', line: 4, reason: 'file could not be read' },
    ]);
    expect(gh.checkRunCalls[0]!.summary).toContain('not published: deleted.spec.ts:4');
  });

  it('opens no PR but still posts a neutral check when there is nothing confident to heal', async () => {
    const gh = recordingGitHub();
    const files = memFileAccess({ 'checkout.spec.ts': specFile('Buy') });
    const suggestions = [sug(loc('checkout.spec.ts', 4, 'Buy'), 'Purchase', '')]; // empty patch

    const result = await publishProactiveHeal(suggestions, summary, pr, gh, files);

    expect(gh.draftPrCalls).toHaveLength(0);
    expect(gh.checkRunCalls).toHaveLength(1);
    expect(gh.checkRunCalls[0]!.conclusion).toBe('neutral');
    expect(result.draftPr).toBeUndefined();
    expect(result.suggested).toBe(0);
    expect(result.unapplied).toEqual([]);
  });

  it('reuses the same branch on a second run for the same PR (idempotent, no duplicate branch)', async () => {
    const gh = recordingGitHub();
    const files = memFileAccess({ 'checkout.spec.ts': specFile('Buy') });
    const suggestions = [sug(loc('checkout.spec.ts', 4, 'Buy'), 'Purchase')];

    await publishProactiveHeal(suggestions, summary, pr, gh, files);
    await publishProactiveHeal(suggestions, summary, pr, gh, files);

    expect(gh.draftPrCalls).toHaveLength(2);
    expect(gh.draftPrCalls.map((c) => c.branch)).toEqual([
      'warden/proactive-heal-pr-42',
      'warden/proactive-heal-pr-42',
    ]);
    // Both runs commit byte-identical content, so the second is a no-op commit, not a revert.
    expect(gh.draftPrCalls[0]!.files).toEqual(gh.draftPrCalls[1]!.files);
  });

  it('has a stable branch name derived only from the PR number', () => {
    expect(proactiveHealBranchName(pr)).toBe('warden/proactive-heal-pr-42');
    expect(proactiveHealBranchName(fixturePr({ number: 7 }))).toBe('warden/proactive-heal-pr-7');
  });
});
