import { describe, expect, it } from 'vitest';
import type { PrRef, Recommendation } from '@warden/core';
import { publish, slug, syncBranchName } from './publisher.js';
import { recordingGitHub } from './testing-fakes.js';

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
    expect(result).toEqual({ draftPrs: [], selfSuggested: 0 });
  });

  it('produces a stable, idempotent branch name', () => {
    expect(syncBranchName('org/e2e-tests', sourcePr)).toBe('warden/sync-org-e2e-tests-pr-42');
    expect(syncBranchName('org/e2e-tests', sourcePr)).toBe(
      syncBranchName('org/e2e-tests', sourcePr),
    );
    expect(slug('Org/E2E_Tests')).toBe('org-e2e-tests');
  });
});
