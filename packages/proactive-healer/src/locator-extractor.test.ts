import { describe, expect, it } from 'vitest';
import type { LocatorRef, TestCase } from '@warden/core';
import { extractLocators } from './locator-extractor.js';
import { memFileAccess } from './testing-fakes.js';

function tc(id: string, filePath?: string): TestCase {
  return {
    id,
    title: `case ${id}`,
    type: 'regression',
    priority: 'P2',
    tags: [],
    requirementIds: [],
    automation: { framework: 'playwright', filePath, testName: 'spec' },
    source: 'manual',
  };
}

const checkout = [
  "import { test, expect } from '@playwright/test';",
  '',
  "test('@regression buy flow', async ({ page }) => {",
  "  await page.getByRole('button', { name: 'Buy' }).click();",
  "  await page.getByLabel('Email').fill('a@b.com');",
  '  await page',
  "    .getByRole('link', { name: 'Terms', exact: true })",
  '    .click();',
  '  const label = dynamicLabel();',
  "  await page.getByRole('button', { name: label }).click();",
  '});',
  '',
].join('\n');

const session = [
  "test('@smoke session login', async () => {",
  "  await session.click('button', 'Sign in');",
  "  await session.fill('Username', 'admin');",
  '});',
  '',
].join('\n');

describe('extractLocators', () => {
  it('extracts role/label locators with exact line numbers, spanning multi-line calls', async () => {
    const files = memFileAccess({
      'tests/e2e/checkout.spec.ts': checkout,
      'tests/e2e/session.spec.ts': session,
    });
    const refs = await extractLocators(
      [tc('TC-1', 'tests/e2e/checkout.spec.ts'), tc('TC-2', 'tests/e2e/session.spec.ts')],
      files,
    );

    const expected: LocatorRef[] = [
      {
        filePath: 'tests/e2e/checkout.spec.ts',
        line: 4,
        testCaseId: 'TC-1',
        kind: 'click',
        role: 'button',
        name: 'Buy',
        sourceLine: "  await page.getByRole('button', { name: 'Buy' }).click();",
      },
      {
        filePath: 'tests/e2e/checkout.spec.ts',
        line: 5,
        testCaseId: 'TC-1',
        kind: 'fill',
        role: 'label',
        name: 'Email',
        sourceLine: "  await page.getByLabel('Email').fill('a@b.com');",
      },
      {
        filePath: 'tests/e2e/checkout.spec.ts',
        line: 7,
        testCaseId: 'TC-1',
        kind: 'click',
        role: 'link',
        name: 'Terms',
        sourceLine: "    .getByRole('link', { name: 'Terms', exact: true })",
      },
      {
        filePath: 'tests/e2e/session.spec.ts',
        line: 2,
        testCaseId: 'TC-2',
        kind: 'click',
        role: 'button',
        name: 'Sign in',
        sourceLine: "  await session.click('button', 'Sign in');",
      },
      {
        filePath: 'tests/e2e/session.spec.ts',
        line: 3,
        testCaseId: 'TC-2',
        kind: 'fill',
        role: 'label',
        name: 'Username',
        sourceLine: "  await session.fill('Username', 'admin');",
      },
    ];
    expect(refs).toEqual(expected);
  });

  it("carries each locator's exact source line, so a repair patch is one that applies", async () => {
    const files = memFileAccess({ 'tests/e2e/checkout.spec.ts': checkout });
    const lines = checkout.split('\n');

    const refs = await extractLocators([tc('TC-1', 'tests/e2e/checkout.spec.ts')], files);

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.sourceLine).toBe(lines[ref.line - 1]);
      expect(ref.sourceLine).toContain(ref.name);
    }
  });

  it('ignores dynamic (non-string) locator names and non-locator code', async () => {
    const files = memFileAccess({ 'tests/e2e/checkout.spec.ts': checkout });
    const refs = await extractLocators([tc('TC-1', 'tests/e2e/checkout.spec.ts')], files);
    // The dynamic `{ name: label }` call on line 10 is never extracted.
    expect(refs.some((r) => r.line === 10)).toBe(false);
    expect(refs.every((r) => r.name !== 'label')).toBe(true);
  });

  it('skips test cases with no spec file and files that do not exist', async () => {
    const files = memFileAccess({ 'tests/e2e/session.spec.ts': session });
    const refs = await extractLocators(
      [
        tc('TC-3'),
        tc('TC-4', 'tests/e2e/missing.spec.ts'),
        tc('TC-2', 'tests/e2e/session.spec.ts'),
      ],
      files,
    );
    expect(refs.map((r) => r.testCaseId)).toEqual(['TC-2', 'TC-2']);
  });

  it('scans a shared spec file only once (first owning test case wins)', async () => {
    const files = memFileAccess({ 'tests/e2e/session.spec.ts': session });
    const refs = await extractLocators(
      [tc('TC-2', 'tests/e2e/session.spec.ts'), tc('TC-9', 'tests/e2e/session.spec.ts')],
      files,
    );
    expect(refs).toHaveLength(2);
    expect(refs.every((r) => r.testCaseId === 'TC-2')).toBe(true);
  });
});
