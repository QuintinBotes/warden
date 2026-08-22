import { describe, expect, it } from 'vitest';
import type { PrRef, Recommendation } from '@warden/core';
import { publish, slug, syncBranchName } from './publisher.js';
import { memFileAccess, recordingGitHub } from './testing-fakes.js';

const sourcePr: PrRef = {
  owner: 'org',
  repo: 'checkout',
  number: 42,
  headSha: 'abc123',
  headRef: 'feature/pay',
};

const recs: Recommendation[] = [
  {
    kind: 'test',
    action: 'add',
    targetRepo: 'org/e2e-tests',
    path: 'tests/checkout.spec.ts',
    reason: 'new route',
    content: 'ADD',
  },
  {
    kind: 'test',
    action: 'remove',
    targetRepo: 'org/e2e-tests',
    path: 'tests/legacy.spec.ts',
    reason: 'route removed',
    patch: 'DEL',
  },
  {
    kind: 'doc',
    action: 'update',
    targetRepo: 'self',
    path: 'docs/checkout.md',
    reason: 'behavior changed',
    content: 'DOC',
  },
];

describe('publish', () => {
  it('opens a draft PR for external repos with a null-content deletion, plus self suggestions and a check', async () => {
    const gh = recordingGitHub();

    const result = await publish(recs, sourcePr, gh);

    expect(gh.draftPrCalls).toHaveLength(1);
    const draft = gh.draftPrCalls[0]!;
    expect(draft.repo).toBe('org/e2e-tests');
    expect(draft.branch).toBe('warden/sync-org-e2e-tests-pr-42');
    expect(draft.files).toContainEqual({ path: 'tests/checkout.spec.ts', content: 'ADD' });
    expect(draft.files).toContainEqual({ path: 'tests/legacy.spec.ts', content: null });

    expect(gh.suggestionCalls).toHaveLength(1);
    expect(gh.suggestionCalls[0]!.files).toEqual([{ path: 'docs/checkout.md', content: 'DOC' }]);

    expect(gh.checkRunCalls).toHaveLength(1);
    expect(gh.checkRunCalls[0]!.conclusion).toBe('success');

    expect(result.draftPrs).toEqual([
      { repo: 'org/e2e-tests', url: 'https://github.com/org/e2e-tests/pull/101', number: 101 },
    ]);
    expect(result.selfSuggested).toBe(1);
  });

  it('excludes `remove` recommendations from self suggestions', async () => {
    const gh = recordingGitHub();

    await publish(
      [
        {
          kind: 'test',
          action: 'remove',
          targetRepo: 'self',
          path: 'src/legacy.test.ts',
          reason: 'gone',
          patch: 'DEL',
        },
      ],
      sourcePr,
      gh,
    );

    expect(gh.suggestionCalls).toHaveLength(0);
    expect(gh.draftPrCalls).toHaveLength(0);
    expect(gh.checkRunCalls).toHaveLength(1);
  });

  it('posts a neutral check and opens nothing when there are no recommendations', async () => {
    const gh = recordingGitHub();

    const result = await publish([], sourcePr, gh);

    expect(gh.draftPrCalls).toHaveLength(0);
    expect(gh.suggestionCalls).toHaveLength(0);
    expect(gh.checkRunCalls).toHaveLength(1);
    expect(gh.checkRunCalls[0]!.conclusion).toBe('neutral');
    expect(result).toEqual({ draftPrs: [], selfSuggested: 0, unpublished: [] });
  });

  it('commits an `update` patch APPLIED to the target file, never the diff text itself', async () => {
    const gh = recordingGitHub();
    const before = ["describe('cart', () => {", "  it('adds', () => {});", '});', ''].join('\n');
    const patch = [
      '--- a/tests/cart.spec.ts',
      '+++ b/tests/cart.spec.ts',
      '@@ -2,1 +2,2 @@',
      "-  it('adds', () => {});",
      "+  it('adds', () => {});",
      "+  it('removes', () => {});",
      '',
    ].join('\n');

    await publish(
      [
        {
          kind: 'test',
          action: 'update',
          targetRepo: 'org/e2e-tests',
          path: 'tests/cart.spec.ts',
          reason: 'new case',
          patch,
        },
      ],
      sourcePr,
      gh,
      { fileAccessFor: () => memFileAccess({ 'tests/cart.spec.ts': before }) },
    );

    const entry = gh.draftPrCalls[0]!.files[0]!;
    expect(entry.content).toBe(
      [
        "describe('cart', () => {",
        "  it('adds', () => {});",
        "  it('removes', () => {});",
        '});',
        '',
      ].join('\n'),
    );
    expect(entry.content).not.toContain('@@');
    expect(entry.content).not.toContain('--- a/');
    expect(entry.content).toContain("describe('cart'");
  });

  it('does not commit a patch that will not apply, and names it on the check run', async () => {
    const gh = recordingGitHub();
    const patch = [
      '--- a/tests/cart.spec.ts',
      '+++ b/tests/cart.spec.ts',
      '@@ -2,1 +2,1 @@',
      "-  it('gone', () => {});",
      "+  it('renamed', () => {});",
      '',
    ].join('\n');

    const result = await publish(
      [
        {
          kind: 'test',
          action: 'update',
          targetRepo: 'org/e2e-tests',
          path: 'tests/cart.spec.ts',
          reason: 'drifted',
          patch,
        },
      ],
      sourcePr,
      gh,
      { fileAccessFor: () => memFileAccess({ 'tests/cart.spec.ts': 'something else\n' }) },
    );

    expect(gh.draftPrCalls).toHaveLength(0);
    expect(result.draftPrs).toEqual([]);
    expect(result.unpublished).toHaveLength(1);
    expect(result.unpublished[0]!.path).toBe('tests/cart.spec.ts');
    expect(gh.checkRunCalls[0]!.summary).toContain(
      'not published: org/e2e-tests tests/cart.spec.ts',
    );
  });

  it('publishes nothing for a patch it has no read access to, rather than the patch text', async () => {
    const gh = recordingGitHub();

    const result = await publish(
      [
        {
          kind: 'test',
          action: 'update',
          targetRepo: 'org/e2e-tests',
          path: 'tests/cart.spec.ts',
          reason: 'drifted',
          patch: '--- a/tests/cart.spec.ts\n+++ b/tests/cart.spec.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n',
        },
      ],
      sourcePr,
      gh,
    );

    expect(gh.draftPrCalls).toHaveLength(0);
    expect(result.unpublished[0]!.reason).toContain('no read access');
  });

  it('suggests the patched file on the source PR, since a suggestion block is committable', async () => {
    const gh = recordingGitHub();
    const before = ['# Checkout', '', 'Pay with a card.', ''].join('\n');
    const patch = [
      '--- a/docs/checkout.md',
      '+++ b/docs/checkout.md',
      '@@ -3,1 +3,1 @@',
      '-Pay with a card.',
      '+Pay with a card or a wallet.',
      '',
    ].join('\n');

    await publish(
      [
        {
          kind: 'doc',
          action: 'update',
          targetRepo: 'self',
          path: 'docs/checkout.md',
          reason: 'behavior changed',
          patch,
        },
      ],
      sourcePr,
      gh,
      { fileAccessFor: () => memFileAccess({ 'docs/checkout.md': before }) },
    );

    expect(gh.suggestionCalls[0]!.files).toEqual([
      { path: 'docs/checkout.md', content: '# Checkout\n\nPay with a card or a wallet.\n' },
    ]);
  });

  it('publishes nothing for a recommendation carrying neither contents nor a patch', async () => {
    const gh = recordingGitHub();

    const result = await publish(
      [
        {
          kind: 'doc',
          action: 'add',
          targetRepo: 'org/docs',
          path: 'docs/new.md',
          reason: 'missing',
        },
      ],
      sourcePr,
      gh,
    );

    expect(gh.draftPrCalls).toHaveLength(0);
    expect(result.unpublished).toEqual([
      {
        repo: 'org/docs',
        path: 'docs/new.md',
        reason: 'recommendation carries neither file contents nor a patch',
      },
    ]);
  });

  it('produces a stable, idempotent branch name', () => {
    expect(syncBranchName('org/e2e-tests', sourcePr)).toBe('warden/sync-org-e2e-tests-pr-42');
    expect(syncBranchName('org/e2e-tests', sourcePr)).toBe(
      syncBranchName('org/e2e-tests', sourcePr),
    );
    expect(slug('Org/E2E_Tests')).toBe('org-e2e-tests');
  });
});
