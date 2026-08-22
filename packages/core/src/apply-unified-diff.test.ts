import { describe, expect, it } from 'vitest';
import { applyUnifiedDiff, parseUnifiedDiffHunks } from './apply-unified-diff';

const FILE = [
  "import { test, expect } from '@playwright/test';",
  '',
  "test('checkout', async ({ page }) => {",
  "  await page.goto('/cart');",
  "  await page.getByRole('button', { name: 'Buy' }).click();",
  "  await expect(page).toHaveURL('/thanks');",
  '});',
  '',
].join('\n');

function diff(...body: string[]): string {
  return ['--- a/checkout.spec.ts', '+++ b/checkout.spec.ts', ...body, ''].join('\n');
}

describe('applyUnifiedDiff', () => {
  it('rewrites only the patched line and keeps every other line of the file', () => {
    const result = applyUnifiedDiff(
      FILE,
      diff(
        '@@ -5,1 +5,1 @@',
        "-  await page.getByRole('button', { name: 'Buy' }).click();",
        "+  await page.getByRole('button', { name: 'Purchase' }).click();",
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe(FILE.replace("name: 'Buy'", "name: 'Purchase'"));
    expect(result.content).toContain("import { test, expect } from '@playwright/test';");
    expect(result.content).toContain("await expect(page).toHaveURL('/thanks');");
    expect(result.content).not.toContain('@@');
  });

  it('applies concatenated per-line diffs for the same file in one pass', () => {
    const two = [
      diff('@@ -4,1 +4,1 @@', "-  await page.goto('/cart');", "+  await page.goto('/basket');"),
      diff(
        '@@ -5,1 +5,1 @@',
        "-  await page.getByRole('button', { name: 'Buy' }).click();",
        "+  await page.getByRole('button', { name: 'Purchase' }).click();",
      ),
    ].join('');

    const result = applyUnifiedDiff(FILE, two);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain("goto('/basket')");
    expect(result.content).toContain("name: 'Purchase'");
  });

  it('tracks the line drift of an earlier hunk that added lines', () => {
    const patch = [
      diff('@@ -2,1 +2,2 @@', '-', '+', "+test.describe.configure({ mode: 'serial' });"),
      diff(
        '@@ -5,1 +5,1 @@',
        "-  await page.getByRole('button', { name: 'Buy' }).click();",
        "+  await page.getByRole('button', { name: 'Purchase' }).click();",
      ),
    ].join('');

    const result = applyUnifiedDiff(FILE, patch);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.split('\n')[2]).toBe("test.describe.configure({ mode: 'serial' });");
    expect(result.content).toContain("name: 'Purchase'");
  });

  it('finds a hunk whose stated line number is wrong but whose context is unique', () => {
    const result = applyUnifiedDiff(
      FILE,
      diff(
        '@@ -99,1 +99,1 @@',
        "-  await page.getByRole('button', { name: 'Buy' }).click();",
        "+  await page.getByRole('button', { name: 'Purchase' }).click();",
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain("name: 'Purchase'");
  });

  it('refuses a hunk whose context is nowhere in the file rather than writing it', () => {
    const result = applyUnifiedDiff(
      FILE,
      diff('@@ -5,1 +5,1 @@', "-  getByRole('button', { name: 'Buy' })", "+  getByRole('x')"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('does not match the file');
  });

  it('refuses an ambiguous hunk instead of picking the first match', () => {
    const repeated = ['a();', 'b();', 'a();', ''].join('\n');

    const result = applyUnifiedDiff(repeated, diff('@@ -9,1 +9,1 @@', '-a();', '+c();'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('refusing to guess');
    expect(repeated).toContain('a();');
  });

  it('refuses text that carries no hunks — an empty patch is not a successful no-op', () => {
    expect(applyUnifiedDiff(FILE, '')).toEqual({
      ok: false,
      reason: 'patch carries no unified-diff hunks',
    });
    expect(applyUnifiedDiff(FILE, 'just a sentence about the file')).toEqual({
      ok: false,
      reason: 'patch carries no unified-diff hunks',
    });
  });

  it('parses a removal line that begins with --- as content, not as the next file header', () => {
    const hunks = parseUnifiedDiffHunks(diff('@@ -1,1 +1,1 @@', '---- dashes', '+// dashes'));

    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.oldLines).toEqual(['--- dashes']);
    expect(hunks[0]!.newLines).toEqual(['// dashes']);
  });
});
