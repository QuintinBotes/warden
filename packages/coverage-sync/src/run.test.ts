import { describe, expect, it } from 'vitest';
import { defineConfig, type CoverageRecommender, type DiffFile, type PrRef } from '@warden/core';
import { fakeProvider, fixtureChangeSurface } from '@warden/core/testing';
import { runCoverageSync, type RunCoverageSyncInput } from './run.js';
import { memFileAccess, recordingGitHub } from './testing-fakes.js';

const sourcePr: PrRef = {
  owner: 'org',
  repo: 'checkout',
  number: 42,
  headSha: 'abc123',
  headRef: 'feature/pay',
};

const diff: DiffFile[] = [
  { path: 'services/checkout/pay.ts', status: 'modified' },
  { path: 'services/checkout/legacy.ts', status: 'deleted' },
];

/** A stub recommender that ignores its input and returns a fixed set of recs. */
const stubRecommender: CoverageRecommender = {
  async recommend() {
    return [
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
  },
};

const throwingRecommender: CoverageRecommender = {
  async recommend() {
    throw new Error('recommender should not be called');
  },
};

function baseInput(overrides: Partial<RunCoverageSyncInput> = {}): RunCoverageSyncInput {
  const trees: Record<string, Record<string, string>> = {
    'org/e2e-tests': { 'tests/legacy.spec.ts': 'old test' },
    'org/checkout': { 'docs/intro.md': '# intro' },
  };
  return {
    sourcePr,
    sourceRepo: 'org/checkout',
    diff,
    cfg: defineConfig({
      links: {
        testRepos: [{ repo: 'org/e2e-tests', pathPrefix: 'tests/', mapping: 'by-path' }],
        docRepos: [{ repo: 'self', pathPrefix: 'docs/' }],
        dependents: [],
      },
    }),
    fileAccessFor: (repo) => memFileAccess(trees[repo] ?? {}),
    gh: recordingGitHub(),
    recommender: stubRecommender,
    provider: fakeProvider(),
    computeChangeSurface: () =>
      fixtureChangeSurface({
        changedModules: ['checkout'],
        affectedApiRoutes: [],
        affectedComponents: [],
        changedFiles: ['services/checkout/pay.ts'],
      }),
    ...overrides,
  };
}

describe('runCoverageSync', () => {
  it('drives the full pipeline into a draft PR, self suggestions, and a check', async () => {
    const gh = recordingGitHub();

    const summary = await runCoverageSync(baseInput({ gh }));

    expect(summary.status).toBe('published');
    expect(summary.gaps.length).toBeGreaterThan(0);

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

    expect(summary.draftPrs).toHaveLength(1);
    expect(summary.selfSuggested).toBe(1);
  });

  it('posts a single neutral check and opens no PRs when there are no links', async () => {
    const gh = recordingGitHub();

    const summary = await runCoverageSync(
      baseInput({ gh, cfg: defineConfig(), recommender: throwingRecommender }),
    );

    expect(summary.status).toBe('no-links');
    expect(gh.checkRunCalls).toHaveLength(1);
    expect(gh.checkRunCalls[0]!.conclusion).toBe('neutral');
    expect(gh.draftPrCalls).toHaveLength(0);
    expect(gh.suggestionCalls).toHaveLength(0);
  });

  it('posts a single neutral check and opens no PRs when there are no gaps', async () => {
    const gh = recordingGitHub();

    // A change surface with no subjects yields no gaps, so the recommender never runs.
    const summary = await runCoverageSync(
      baseInput({
        gh,
        recommender: throwingRecommender,
        computeChangeSurface: () =>
          fixtureChangeSurface({
            changedModules: [],
            affectedApiRoutes: [],
            affectedComponents: [],
          }),
        diff: [{ path: 'services/checkout/pay.ts', status: 'modified' }],
      }),
    );

    expect(summary.status).toBe('no-gaps');
    expect(gh.checkRunCalls).toHaveLength(1);
    expect(gh.checkRunCalls[0]!.conclusion).toBe('neutral');
    expect(gh.draftPrCalls).toHaveLength(0);
  });

  it('uses a stable branch name across two runs (idempotent)', async () => {
    const first = recordingGitHub();
    const second = recordingGitHub();

    await runCoverageSync(baseInput({ gh: first }));
    await runCoverageSync(baseInput({ gh: second }));

    expect(first.draftPrCalls[0]!.branch).toBe(second.draftPrCalls[0]!.branch);
  });

  it('derives a change surface with the built-in default when none is injected', async () => {
    const summary = await runCoverageSync(
      baseInput({
        cfg: defineConfig(),
        recommender: throwingRecommender,
        computeChangeSurface: undefined,
        diff: [{ path: 'apps/checkout/pay.ts', status: 'modified' }],
      }),
    );

    expect(summary.status).toBe('no-links');
    expect(summary.changeSurface.changedModules).toContain('apps/checkout');
  });
});
