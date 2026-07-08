import type { SourceCodeRef, TestCase, TmsSource } from '@warden/core';

/**
 * Per-source parse/inject of the stable-id tag that carries an external test-management id in-band
 * on a local `TestCase`. No `TestCaseSchema` change: the external id lives as a **tag**
 * (`@T1a2b3c4d`, `@Qase-42`, `@C123`, `@CALC-1234`, `@ZE-5`, `@AS-9`), so the round-trip is
 * ID-stable in committed code. Each convention is used only for its own `source`, so tag shapes
 * that overlap across tools (Xray vs Zephyr keys) never collide in practice.
 */

interface TagConvention {
  /** Build the code tag that carries `externalId` (idempotent — accepts an id already tagged). */
  toTag(externalId: string): string;
  /** Extract the `externalId` from a single tag, or `undefined` when it doesn't match this source. */
  externalIdFromTag(tag: string): string | undefined;
}

const KEY = /^@([A-Za-z][A-Za-z0-9_]*-\d+)$/;

const CONVENTIONS: Record<TmsSource, TagConvention> = {
  // testomat.io ids are already `@T…`; the tag is the id verbatim.
  testomatio: {
    toTag: (id) => (id.startsWith('@') ? id : `@${id}`),
    externalIdFromTag: (tag) => (/^@T[0-9A-Za-z]+$/.test(tag) ? tag : undefined),
  },
  qase: {
    toTag: (id) => `@Qase-${id.replace(/^@?Qase-/i, '')}`,
    externalIdFromTag: (tag) => {
      const m = /^@Qase-(.+)$/i.exec(tag);
      return m ? m[1] : undefined;
    },
  },
  testrail: {
    toTag: (id) => `@${id.startsWith('C') ? id : `C${id.replace(/^@/, '')}`}`,
    externalIdFromTag: (tag) => {
      const m = /^@(C\d+)$/.exec(tag);
      return m ? m[1] : undefined;
    },
  },
  xray: {
    toTag: (id) => `@${id.replace(/^@/, '')}`,
    externalIdFromTag: (tag) => {
      const m = KEY.exec(tag);
      return m ? m[1] : undefined;
    },
  },
  zephyr: {
    toTag: (id) => `@${id.replace(/^@/, '')}`,
    externalIdFromTag: (tag) => {
      const m = KEY.exec(tag);
      return m ? m[1] : undefined;
    },
  },
  'allure-testops': {
    toTag: (id) => `@${id.startsWith('AS-') ? id : `AS-${id.replace(/^@/, '')}`}`,
    externalIdFromTag: (tag) => {
      const m = /^@(AS-\d+)$/.exec(tag);
      return m ? m[1] : undefined;
    },
  },
};

/** The stable-id tag string for `externalId` under `source` (e.g. `('qase','42') → '@Qase-42'`). */
export function externalIdTag(source: TmsSource, externalId: string): string {
  return CONVENTIONS[source].toTag(externalId);
}

/** The external id carried by `tags` under `source`, or `undefined` if none is present. */
export function parseExternalId(source: TmsSource, tags: string[]): string | undefined {
  for (const tag of tags) {
    const id = CONVENTIONS[source].externalIdFromTag(tag);
    if (id !== undefined) return id;
  }
  return undefined;
}

/**
 * Return a new `tags` array carrying `externalId`. Idempotent: if the exact id tag is already
 * present the array is returned unchanged; a stale id tag for the same source is replaced.
 */
export function injectExternalId(source: TmsSource, tags: string[], externalId: string): string[] {
  const convention = CONVENTIONS[source];
  const wanted = convention.toTag(externalId);
  const idTags = tags.filter((tag) => convention.externalIdFromTag(tag) !== undefined);
  // Already carries exactly this id and no stale one → return unchanged (true no-op).
  if (idTags.length === 1 && idTags[0] === wanted) return tags;
  const withoutStaleId = tags.filter((tag) => convention.externalIdFromTag(tag) === undefined);
  return [...withoutStaleId, wanted];
}

/**
 * Map a local `TestCase`'s automation block to a `SourceCodeRef`, when it points at real code.
 * Only Playwright is shared between the local automation enum and the source-code-first frameworks,
 * so non-Playwright frameworks fall back to `'playwright'` (the default TMS import framework).
 */
export function sourceRefFromTestCase(testCase: TestCase): SourceCodeRef | undefined {
  const { filePath, testName } = testCase.automation;
  if (!filePath || !testName) return undefined;
  return { filePath, testName, framework: 'playwright' };
}

/** Parse the external id a local `TestCase` already carries under `source`, if any. */
export function externalIdFromTestCase(source: TmsSource, testCase: TestCase): string | undefined {
  return parseExternalId(source, testCase.tags);
}

/** Return a copy of `testCase` with `externalId` injected as a tag (idempotent). */
export function withExternalId(
  source: TmsSource,
  testCase: TestCase,
  externalId: string,
): TestCase {
  return { ...testCase, tags: injectExternalId(source, testCase.tags, externalId) };
}
